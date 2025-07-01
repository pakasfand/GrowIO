const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Matter = require('matter-js');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Update loops
const PHYSICS_UPDATE_RATE = 1000 / 60; // 60 FPS
const STATE_UPDATE_RATE = 1000 / 30; // 30 FPS
const LEADERBOARD_UPDATE_RATE = 1000; // 1 second

// Pickups
const PICK_UP_SPAWN_RATE = 200;
const PICK_UP_RADIUS = 5;

// World and game data
const WORLD_SIZE = 5000;
const MIN_CELL_RADIUS = 10;
const MAX_CELL_RADIUS = 500;
const MAX_CELL_SPEED = 0.5;
const MIN_CELL_SPEED = 0.01;
const CELL_SPEED_FACTOR = 0.005;
const CELL_SPEED_GROWTH_FACTOR = 0.05;
const CELL_RADIUS_GROW_FACTOR = 0.02;
const MAX_PICKUP_COUNT = 100;
const DEFAULT_PLAYER_USERNAME = "Player";
const LEADERBOARD_SIZE = 5;

// Split mechanic
const MIN_SPLIT_RADIUS = 35;
const SPLIT_RATIO = 0.5;
const SPLIT_COOLDOWN = 3000;
const MERGE_TIMER = 10000;
const CELL_CATEGORY = 0x0001;
const PICKUP_CATEGORY = 0x0002;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve client files
app.use(express.static('dist'));
app.use(express.static('public')); // Fallback for assets

const players = {};
const pickUps = {};

var physicsEngine = Matter.Engine.create();
physicsEngine.gravity.x = 0;
physicsEngine.gravity.y = 0;

wss.on('connection', (ws) => {
    const playerId = uuidv4();

    ws.send(JSON.stringify(
    { 
        type: 'init', 
        playerId: playerId,
        allPlayerData: Object.fromEntries(Object.entries(players).map(([id, player]) => [id, {
            ...player.data,
            cells: Object.fromEntries(Object.entries(player.data.cells).map(([cellId, cell]) => [
                cellId,
                cell.data
            ]))
        }])),
    }));

    ws.on('message', (msg) => {
        const message = JSON.parse(msg);
        
        if (message.type === 'connect') {
            let playerUsername = message.username || DEFAULT_PLAYER_USERNAME;
            players[playerId] = 
            {
                data: {
                    id: playerId,
                    username: playerUsername,
                    cells: {}
                }
            };
            
            let cellId = uuidv4();
            players[playerId].data.cells[cellId] = initCell(cellId, playerId, playerUsername);
            
            console.log(`Player ${playerUsername} (${playerId}) connected`);
        }
        else if (message.type === 'input') {
            // Update all cells belonging to this player
            const player = players[playerId];
            for ([cellId, cell] of Object.entries(player.data.cells)) {
                cell.data.targetX = message.targetX;
                cell.data.targetY = message.targetY;
            }
        }
        else if (message.type === 'split') {
            handleSplit(message.id, message.targetX, message.targetY);
        }
    });

    ws.on('close', () => {
        let player = players[playerId];
        if (player) {
            console.log(`Player ${player.data.username || 'Unknown'} (${playerId}) disconnected`);
            for (const cell of Object.values(player.data.cells)) {
                Matter.World.remove(physicsEngine.world, cell.physics.body);
                delete player.data.cells[cell.data.id];
            }
            delete players[playerId];
        }
    });
});

function initCell(cellId, ownerPlayerId, username, color = null)
{
    const startX = WORLD_SIZE / 2 + Math.random() * 200 - 100;
    const startY = WORLD_SIZE / 2 + Math.random() * 200 - 100;

    const cell = {
        data: {
            id: cellId,
            ownerPlayerId: ownerPlayerId,
            x: startX,
            y: startY,
            radius: getCellRadius(1),
            targetX: startX,
            targetY: startY,
            speed: getCellSpeed(1),
            color: color ?? Math.random() * 0xffffff,
            username: username,
            score: 1,
            lastSplitTime: 0,
        }
    };

    cell.physics = {
        body: Matter.Bodies.circle(cell.data.x, cell.data.y, cell.data.radius, {
            label: 'cell',
            uuid: cellId,
            inertia: Infinity,
            frictionAir: 0.1,
            mass: 1,
            collisionFilter: createCollisionFilterGroup(ownerPlayerId, CELL_CATEGORY, PICKUP_CATEGORY, true)
        })  
    }

    console.log(`Cell spawned at X: ${cell.physics.body.position.x} Y: ${cell.physics.body.position.y}`)

    Matter.World.add(physicsEngine.world, cell.physics.body);

    return cell;
}

setInterval(() => {
    broadcastStateUpdate();
}, STATE_UPDATE_RATE);

function broadcastStateUpdate() {
    const payload = JSON.stringify({
        type: 'state',
        allPlayerData: Object.fromEntries(Object.entries(players).map(([id, player]) => [id, {
            ...player.data,
            cells: Object.fromEntries(Object.entries(player.data.cells).map(([cellId, cell]) => [
                cellId,
                cell.data
            ]))
        }])),
        pickUps: Object.fromEntries(Object.entries(pickUps).map(([id, p]) => [id, p.data])),
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

setInterval(() => {
    updatePhysicsEngine();
}, PHYSICS_UPDATE_RATE);

function updatePhysicsEngine() {
    for (const playerId in players) {
        const player = players[playerId];

        for(const cell of Object.values(player.data.cells)) {
            const cellBody = cell.physics.body;
    
            const target = Matter.Vector.create(cell.data.targetX, cell.data.targetY);
            const current = cellBody.position;
            const direction = Matter.Vector.normalise(Matter.Vector.sub(target, current));
    
            // Apply force towards target instead of setting velocity directly
            const forceMagnitude = cell.data.speed * CELL_SPEED_FACTOR; // Adjust multiplier as needed
            Matter.Body.applyForce(cellBody, cellBody.position, {
                x: direction.x * forceMagnitude,
                y: direction.y * forceMagnitude
            });
        }
    }

    Matter.Engine.update(physicsEngine, PHYSICS_UPDATE_RATE);

    for (const playerId in players) {
        const player = players[playerId];

        for(const cell of Object.values(player.data.cells)) {
            cell.data.x = cell.physics.body.position.x;
            cell.data.y = cell.physics.body.position.y;
        }
    }

    checkForMerges();

    checkCellOverlaps();
    
    enableMergingForSplitCells();
}

function checkCellOverlaps() {
    const cells = getAllCells();

    for (let i = 0; i < Object.keys(cells).length; i++) {
        for (let j = i + 1; j < Object.keys(cells).length; j++) {
            const cellA = cells[i];
            const cellB = cells[j];
            const bodyA = cellA.physics.body;
            const bodyB = cellB.physics.body;
            const playerA = findPlayerByCellId(cellA.data.id);
            const playerB = findPlayerByCellId(cellB.data.id);

            if (!cellA || !cellB || !playerA || !playerB) continue;
            // Skip self-collisions
            if (playerA.data.id === playerB.data.id) continue;

            const collision = Matter.Collision.collides(bodyA, bodyB);
            if (collision && collision.collided) {
                if (circleContainsCircle(bodyA, bodyB)) {
                    console.log(`${bodyA.uuid} fully contains ${bodyB.uuid}`);
                    onCellEaten(bodyB.uuid, cellB.data.ownerPlayerId, playerB.data.username);
                    growCell(bodyA.uuid, playerA.data.id);
                } else if (circleContainsCircle(bodyB, bodyA)) {
                    console.log(`${bodyB.uuid} fully contains ${bodyA.uuid}`);
                    onCellEaten(bodyA.uuid, cellA.data.ownerPlayerId, playerA.data.username);
                    growCell(bodyB.uuid, playerB.data.id);
                }
            }
        }
    }
}

function checkForMerges() {
    for (const player of Object.values(players)) {
        const cellIds = Object.keys(player.data.cells);
        
        for (let i = 0; i < cellIds.length; i++) {
            for (let j = i + 1; j < cellIds.length; j++) {
                const cellA = player.data.cells[cellIds[i]];
                const cellB = player.data.cells[cellIds[j]];
                
                // Check if both cells belong to the same player and are not colliding with each other
                if (cellA.data.ownerPlayerId === cellB.data.ownerPlayerId && 
                    cellA.physics.body.collisionFilter.group === cellB.physics.body.collisionFilter.group && 
                    cellA.physics.body.collisionFilter.group < 0) 
                {
                    if(circleContainsCircle(cellA.physics.body, cellB.physics.body) || 
                        circleContainsCircle(cellB.physics.body, cellA.physics.body)) 
                    {
                        mergeCells(player.data.cells, cellA.data.id, cellB.data.id);
                        return;
                    }
                }
            }
        }
    }
}

function mergeCells(cells, cellAId, cellBId) {
    const cellA = cells[cellAId];
    const cellB = cells[cellBId];
    
    if (!cellA || !cellB) return;
    
    // Calculate merged properties
    const mergedRadius = Math.sqrt(cellA.data.radius * cellA.data.radius + cellB.data.radius * cellB.data.radius);
    const mergedScore = cellA.data.score + cellB.data.score;
    const mergedX = (cellA.data.x + cellB.data.x) / 2;
    const mergedY = (cellA.data.y + cellB.data.y) / 2;
    
    // Update cell A with merged properties
    cellA.data.radius = mergedRadius;
    cellA.data.score = mergedScore;
    cellA.data.x = mergedX;
    cellA.data.y = mergedY;
    cellA.data.speed = getCellSpeed(mergedScore);
    
    // Update physics body for cell A
    const oldBody = cellA.physics.body;
    const newBody = Matter.Bodies.circle(
        mergedX,
        mergedY,
        mergedRadius,
        { 
            label: 'cell',
            uuid: cellAId,
            inertia: Infinity,
            frictionAir: 0.1,
            mass: 1,
        }
    );

    newBody.collisionFilter = createCollisionFilterGroup(cellA.data.ownerPlayerId, CELL_CATEGORY, PICKUP_CATEGORY, true);
    newBody.uuid = cellAId;
    
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    cellA.physics.body = newBody;
    
    // Remove cell B
    Matter.World.remove(physicsEngine.world, cellB.physics.body);
    delete cells[cellBId];
    
    console.log(`Cells ${cellAId} and ${cellBId} merged into ${cellAId}`);
}

function enableMergingForSplitCells() {
    const currentTime = Date.now();
    for (const player of Object.values(players)) {
        for (const cell of Object.values(player.data.cells)) {
            // Check if this cell has passed the merge timer since its last split
            if (cell.data.lastSplitTime && 
                currentTime - cell.data.lastSplitTime >= MERGE_TIMER && cell.physics.body.collisionFilter.group > 0) {
                
                cell.physics.body.collisionFilter = 
                    createCollisionFilterGroup(cell.data.ownerPlayerId, CELL_CATEGORY, PICKUP_CATEGORY, true);
            }
        }
    }
}

function randPos() {
    return Math.random() * WORLD_SIZE;
}

setInterval(() => {
    spawnPickUp();
}, PICK_UP_SPAWN_RATE);

function spawnPickUp() {
    if (Object.keys(pickUps).length >= MAX_PICKUP_COUNT) return;

    let pickUpId = uuidv4();
    pickUps[pickUpId] = initPickUp(pickUpId);
}

function initPickUp(pickUpId)
{
    const pickUp = {
        data: {
            id: pickUpId,
            x: randPos(),
            y: randPos(),
            radius: PICK_UP_RADIUS,
            color: Math.random() * 0xffffff,       
        }
    }
    
    pickUp.physics = {
        body: Matter.Bodies.circle(pickUp.data.x, pickUp.data.y, pickUp.data.radius, {
            label: 'pickup',
            isSensor: true,
            uuid: pickUpId,
            collisionFilter: createCollisionFilterGroup(pickUpId, PICKUP_CATEGORY, CELL_CATEGORY, true)
        })
    }
    
    console.log(`Pick up spawned at X: ${pickUp.physics.body.position.x} Y: ${pickUp.physics.body.position.y}`)
    
    Matter.World.add(physicsEngine.world, [pickUp.physics.body]);

    return pickUp;
}

setInterval(() => {
    broadcastLeaderboardUpdate();
}, LEADERBOARD_UPDATE_RATE);

function broadcastLeaderboardUpdate() {
    // Group cells by playerId and sum their scores
    const playerScores = {};
    
    for (const player of Object.values(players)) {
        if (!playerScores[player.data.id]) {
            playerScores[player.data.id] = {username: player.data.username, totalScore: 0};
        }

        for (const cell of Object.values(player.data.cells)) {
            playerScores[player.data.id].totalScore += cell.data.score;
        }
    }

    // Convert to array and sort by total score
    const topPlayers = Object.values(playerScores)
        .sort((a, b) => b.totalScore - a.totalScore)
        .slice(0, LEADERBOARD_SIZE);

    const leaderboard = topPlayers.map(p => ({
        username: p.username,
        totalScore: p.totalScore
    }));

    const payload = JSON.stringify({
        type: 'leaderboard',
        leaderboard: leaderboard
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

Matter.Events.on(physicsEngine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        
        const labels = [bodyA.label, bodyB.label];
        
        if (labels.includes('cell') && labels.includes('pickup')) {
            const pickUpBody = bodyA.label === 'pickup' ? bodyA : bodyB;
            const cellBody = bodyA.label === 'cell' ? bodyA : bodyB;
            const player = findPlayerByCellId(cellBody.uuid);

            console.log('Pickup collected!', pickUpBody.id);
            
            growCell(cellBody.uuid, player.data.id);

            // Remove pickup from world and pickUps object
            Matter.World.remove(physicsEngine.world, pickUpBody);
            delete pickUps[pickUpBody.uuid];
        }
    }
});

function circleContainsCircle(containerBody, innerBody) {
    const dx = containerBody.position.x - innerBody.position.x;
    const dy = containerBody.position.y - innerBody.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    return distance + innerBody.circleRadius <= containerBody.circleRadius;
}

Matter.Events.on(physicsEngine, 'collisionActive', (event) => {
    for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;

        if (bodyA.label === 'cell' && bodyB.label === 'cell') {

            const playerA = findPlayerByCellId(bodyA.uuid);
            const playerB = findPlayerByCellId(bodyB.uuid);

            // Prevent player's own cells from eating each other
            if (playerA && playerB && playerA.data.username === playerB.data.username) {
                continue;
            }

            if (circleContainsCircle(bodyA, bodyB)) {
                console.log(`${bodyA.uuid} fully contains ${bodyB.uuid}`);
                respawnCell(bodyB.uuid, playerB.id, playerB.username);
                growCell(bodyA.uuid, playerA.data.id);
            }

            if (circleContainsCircle(bodyB, bodyA)) {
                console.log(`${bodyB.uuid} fully contains ${bodyA.uuid}`);
                respawnCell(bodyA.uuid, playerA.id, playerA.username);
                growCell(bodyB.uuid, playerB.data.id);
            } 
        }
    }
});

// Unfortunately, we recreate the body because we can't change the radius of an existing circle body
function growCell(cellId, playerId) {
    const cell = players[playerId].data.cells[cellId];

    // Increase score
    cell.data.score += 1;

    // Increase radius
    cell.data.radius = getCellRadius(cell.data.score);

    // Decrease speed
    cell.data.speed = getCellSpeed(cell.data.score)

    const oldBody = cell.physics.body;

    const newBody = Matter.Bodies.circle(
        oldBody.position.x,
        oldBody.position.y,
        cell.data.radius,
        { 
            label: 'cell',
            uuid: cellId,
            inertia: Infinity,
            frictionAir: 0.1,
            mass: 1,
        }
    );
    newBody.collisionFilter = createCollisionFilterGroup(
        playerId, CELL_CATEGORY, PICKUP_CATEGORY, oldBody.collisionFilter.group < 0);

    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    cell.physics.body = newBody;
}

function getGrowthProgress(foodEaten, factor = 0.2) {
    return 1 - Math.exp(-factor * foodEaten);
}

function getCellRadius(foodEaten) {
    const progress = getGrowthProgress(foodEaten, CELL_RADIUS_GROW_FACTOR);
    return MIN_CELL_RADIUS + (MAX_CELL_RADIUS - MIN_CELL_RADIUS) * progress;
}

function getCellSpeed(foodEaten) {
    const progress = getGrowthProgress(foodEaten, CELL_SPEED_GROWTH_FACTOR);
    return MAX_CELL_SPEED - (MAX_CELL_SPEED - MIN_CELL_SPEED) * progress;
}

function onCellEaten(cellId, ownerPlayerId, username)
{
    if(Object.keys(players[ownerPlayerId].data.cells).length == 1)
    {
        respawnCell(cellId, ownerPlayerId, username);
    }
    else
    {
        let cell = players[ownerPlayerId].data.cells[cellId];
        Matter.World.remove(physicsEngine.world, cell.physics.body);
        delete players[ownerPlayerId].data.cells[cellId];
    }
}

function respawnCell(cellId, ownerPlayerId, username)
{
    let oldCell =  players[ownerPlayerId].data.cells[cellId];
    Matter.World.remove(physicsEngine.world, oldCell.physics.body);
    const newCell = initCell(cellId, ownerPlayerId, username, oldCell.data.color);
    players[ownerPlayerId].data.cells[cellId] = newCell;
}

function handleSplit(playerId, targetX, targetY) {
    const player = players[playerId];

    if (!player) return;

    const currentTime = Date.now();
    const playerUsername = player.data.username;
    
    // Find all cells belonging to this player that are big enough to split
    const playerCells = Object.values(player.data.cells);
    const playerCellsAbleToSplit = playerCells.filter(cell => 
        cell.data.radius >= MIN_SPLIT_RADIUS && 
        currentTime - cell.data.lastSplitTime >= SPLIT_COOLDOWN
    );
    
    if (playerCellsAbleToSplit.length === 0) return; // No cells can split

    // Reset last split time for all cells owned by this player
    // Explanation: If a cell splits one after the other one cell is enabled for merging while the other isn't.
    // Causing some cells to overlap but not merge correctly.
    playerCells.forEach(cell => {
        cell.data.lastSplitTime = currentTime;
    });

    // Split all eligible cells
    for (const playerCell of playerCellsAbleToSplit) {
        splitSingleCell(playerCell, targetX, targetY, currentTime);
    }
    
    console.log(`Split ${playerCellsAbleToSplit.length} cells for player ${playerUsername}`);
}

function splitSingleCell(cell, targetX, targetY, currentTime) {
    const cellId = cell.data.id;
    
    // Calculate direction to target
    const dx = targetX - cell.data.x;
    const dy = targetY - cell.data.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return; // Can't split if no direction
    
    let directionX = dx / distance;
    let directionY = dy / distance;

    // Create new cell (the split piece)
    const newCellId = uuidv4();
    const splitDistance = cell.data.radius * 1.5;
    
    const newCell = {
        data: {
            id: newCellId,
            ownerPlayerId: cell.data.ownerPlayerId,
            x: cell.data.x + directionX * splitDistance,
            y: cell.data.y + directionY * splitDistance,
            radius: cell.data.radius * SPLIT_RATIO,
            targetX: targetX,
            targetY: targetY,
            speed: getCellSpeed(Math.floor(cell.data.score * SPLIT_RATIO)),
            color: cell.data.color,
            score: Math.floor(cell.data.score * SPLIT_RATIO),
            lastSplitTime: currentTime,
        }
    };

    newCell.physics = {
        body: Matter.Bodies.circle(newCell.data.x, newCell.data.y, newCell.data.radius, {
            label: 'cell',
            uuid: newCellId,
            inertia: Infinity,
            frictionAir: 0.1,
            mass: 1,
            collisionFilter: createCollisionFilterGroup(newCell.data.ownerPlayerId, CELL_CATEGORY, PICKUP_CATEGORY, false)
        })
    };

    // Update original cell
    cell.data.radius *= SPLIT_RATIO;
    cell.data.score = Math.floor(cell.data.score * SPLIT_RATIO);
    cell.data.speed = getCellSpeed(Math.floor(cell.data.score * SPLIT_RATIO));
    cell.data.lastSplitTime = currentTime;

    // Update physics bodies
    const oldBody = cell.physics.body;
    const newBody = Matter.Bodies.circle(
        oldBody.position.x,
        oldBody.position.y,
        cell.data.radius,
        { 
            label: 'cell',
            uuid: cellId,
            inertia: Infinity,
            frictionAir: 0.1,
            mass: 1,
            collisionFilter: createCollisionFilterGroup(
                cell.data.ownerPlayerId, CELL_CATEGORY, PICKUP_CATEGORY, false)
        }
    );

    // Replace original cell's body
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    cell.physics.body = newBody;

    // Add new cell to world
    Matter.World.add(physicsEngine.world, newCell.physics.body);
    players[cell.data.ownerPlayerId].data.cells[newCellId] = newCell;

    // Apply impulse force to shoot the new cell towards the target position
    const impulseForce = 0.1; // Adjust this value for desired boost strength
    Matter.Body.applyForce(newCell.physics.body, newCell.physics.body.position, {
        x: directionX * impulseForce,
        y: directionY * impulseForce
    });

    console.log(`Cell ${cellId} split into ${newCellId}`);
}

// Map UUID (string) to integer in [1, 32767] range
function generateCollisionFilterGroupId(uuid) {
    let hash = 0;
    for (let i = 0; i < uuid.length; i++) {
        hash = (hash << 5) - hash + uuid.charCodeAt(i);
        hash |= 0; // Convert to 32-bit signed int
    }

    const group = (Math.abs(hash) % 32767) + 1;
    return group;
}

function createCollisionFilterGroup(uuid, category, mask, disableCollisionsWithOwnGroup = false)
{
    let groupId = generateCollisionFilterGroupId(uuid);

    if (disableCollisionsWithOwnGroup) {
        // Use negative ID to disable collisions with bodies in the same collision group
        groupId = -groupId;
    }

    return {
        group: groupId,
        category: category,
        mask: mask
    }
}

function findPlayerByCellId(cellId) {
    return Object.values(players).find(player =>
        cellId in player.data.cells
    );
}

function getAllCells()
{
    let allCellsById = [];
    for (const player of Object.values(players)) {
        Object.entries(player.data.cells).forEach(([cellId, cellData]) => {
            allCellsById.push(cellData);
        });
    }
    return allCellsById;
}

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
