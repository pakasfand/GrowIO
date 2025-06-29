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
const MIN_SNAKE_RADIUS = 10;
const MAX_SNAKE_RADIUS = 500;
// const SNAKE_STARTING_RADIUS = MIN_SNAKE_RADIUS;
const MAX_SNAKE_SPEED = 0.5;
const MIN_SNAKE_SPEED = 0.01;
const SNAKE_SPEED_FACTOR = 0.005;
const SNAKE_SPEED_GROWTH_FACTOR = 0.05;
// const SNAKE_SPEED = MAX_SNAKE_SPEED;
const MAX_PICKUP_COUNT = 100;
const DEFAULT_PLAYER_USERNAME = "Player";
const LEADERBOARD_SIZE = 5;

// Split mechanics
const MIN_SPLIT_RADIUS = 35; // Minimum radius to allow splitting
const SPLIT_RATIO = 0.5; // Each split piece is 50% of original size
const SPLIT_COOLDOWN = 3000; // 3 seconds cooldown between splits
const MERGE_TIMER = 5000; // 5 seconds before split pieces can merge
const MERGE_DISTANCE = 50; // Distance within which pieces can merge

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve client files
app.use(express.static('dist'));
app.use(express.static('public')); // Fallback for assets

const snakes = {};
const pickUps = {};

var physicsEngine = Matter.Engine.create();
physicsEngine.gravity.x = 0;
physicsEngine.gravity.y = 0;

wss.on('connection', (ws) => {
    const snakeId = uuidv4();

    ws.send(JSON.stringify(
    { 
        type: 'init', 
        playerId: snakeId,
        allSnakeData: Object.fromEntries(Object.entries(snakes).map(([id, snake]) => [id, snake.data])),
    }));

    ws.on('message', (msg) => {
        const message = JSON.parse(msg);
        
        if (message.type === 'connect') {
            let playerUsername = message.username || DEFAULT_PLAYER_USERNAME;
            snakes[snakeId] = initSnake(snakeId, playerUsername);
            
            console.log(`Player ${playerUsername} (${snakeId}) connected`);
        }
        else if (message.type === 'input') {
            // Update all snake pieces belonging to this player
            const playerSnakes = Object.values(snakes).filter(s => s.data.username === snakes[message.id]?.data.username);
            for (const s of playerSnakes) {
                s.data.targetX = message.targetX;
                s.data.targetY = message.targetY;
            }
        }
        else if (message.type === 'split') {
            handleSplit(message.id, message.targetX, message.targetY);
        }
    });

    ws.on('close', () => {
        if (snakes[snakeId]) {
            console.log(`Player ${snakes[snakeId].data.username || 'Unknown'} (${snakeId}) disconnected`);
            Matter.World.remove(physicsEngine.world, snakes[snakeId].physics.body);
            delete snakes[snakeId];
        }
    });
});

function initSnake(snakeId, username)
{
    const startX = WORLD_SIZE / 2 + Math.random() * 200 - 100;
    const startY = WORLD_SIZE / 2 + Math.random() * 200 - 100;

    const snake = {
        data: {
            id: snakeId,
            x: startX,
            y: startY,
            radius: getSnakeRadius(1),
            targetX: startX,
            targetY: startY,
            speed: getSnakeSpeed(1),
            color: Math.random() * 0xffffff,
            username: username,
            score: 1,
            lastSplitTime: 0, // Track when last split occurred
            splitFrom: null, // Track which snake this was split from
            splitTime: 0, // Track when this piece was created from a split
        }
    };

    snake.physics = {
        body: Matter.Bodies.circle(snake.data.x, snake.data.y, snake.data.radius, {
            label: 'snake',
            isSensor: true,
            uuid: snakeId,
            inertia: Infinity, // Prevent rotation
            frictionAir: 0.1, // Add air friction for better control
            mass: 1, // Set consistent mass for all snakes regardless of size
        })  
    }

    console.log(`Snake spawned at X: ${snake.physics.body.position.x} Y: ${snake.physics.body.position.y}`)

    Matter.World.add(physicsEngine.world, snake.physics.body);

    return snake;
}

setInterval(() => {
    broadcastStateUpdate();
}, STATE_UPDATE_RATE);

function broadcastStateUpdate() {
    const payload = JSON.stringify({
        type: 'state',
        allSnakeData: Object.fromEntries(Object.entries(snakes).map(([id, snake]) => [id, snake.data])),
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
    for (const id in snakes) {
        const snake = snakes[id];
        const snakeBody = snake.physics.body;

        const target = Matter.Vector.create(snake.data.targetX, snake.data.targetY);
        const current = snakeBody.position;
        const direction = Matter.Vector.normalise(Matter.Vector.sub(target, current));

        // Apply force towards target instead of setting velocity directly
        const forceMagnitude = snake.data.speed * SNAKE_SPEED_FACTOR; // Adjust multiplier as needed
        Matter.Body.applyForce(snakeBody, snakeBody.position, {
            x: direction.x * forceMagnitude,
            y: direction.y * forceMagnitude
        });
    }

    Matter.Engine.update(physicsEngine, PHYSICS_UPDATE_RATE);

    for (const id in snakes) {
        const snake = snakes[id];
        snake.data.x = snake.physics.body.position.x;
        snake.data.y = snake.physics.body.position.y;
    }

    // Check for merges between split pieces
    checkForMerges();
    
    // Enable merging for split pieces that have passed the timer
    enableMergingForSplitPieces();
}

function checkForMerges() {
    const currentTime = Date.now();
    const snakeIds = Object.keys(snakes);
    
    for (let i = 0; i < snakeIds.length; i++) {
        for (let j = i + 1; j < snakeIds.length; j++) {
            const snakeA = snakes[snakeIds[i]];
            const snakeB = snakes[snakeIds[j]];
            
            // Check if both snakes belong to the same player
            if (snakeA.data.username === snakeB.data.username) {
                
                // Check if both pieces have merging enabled (isSensor = true)
                if (!snakeA.physics.body.isSensor || !snakeB.physics.body.isSensor) {
                    continue;
                }
                
                // Calculate dynamic merge distance based on snake sizes
                const combinedRadius = snakeA.data.radius + snakeB.data.radius;
                const dynamicMergeDistance = Math.max(MERGE_DISTANCE, combinedRadius * 0.3); // At least 30% of combined radius
                
                // Check if snakes are close enough to merge
                const dx = snakeA.data.x - snakeB.data.x;
                const dy = snakeA.data.y - snakeB.data.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance <= dynamicMergeDistance) {
                    mergeSnakes(snakeA.data.id, snakeB.data.id);
                    return; // Exit after one merge to avoid conflicts
                }
            }
        }
    }
}

function enableMergingForSplitPieces() {
    const currentTime = Date.now();
    
    for (const snake of Object.values(snakes)) {
        // Check if this snake has passed the merge timer since its last split
        if (snake.data.lastSplitTime && 
            currentTime - snake.data.lastSplitTime >= MERGE_TIMER) {
            
            // Enable merging by setting isSensor to true
            if (!snake.physics.body.isSensor) {
                snake.physics.body.isSensor = true;
                console.log(`Enabled merging for snake ${snake.data.id}`);
            }
        }
    }
}

function mergeSnakes(snakeAId, snakeBId) {
    const snakeA = snakes[snakeAId];
    const snakeB = snakes[snakeBId];
    
    if (!snakeA || !snakeB) return;
    
    // Calculate merged properties
    const mergedRadius = Math.sqrt(snakeA.data.radius * snakeA.data.radius + snakeB.data.radius * snakeB.data.radius);
    const mergedScore = snakeA.data.score + snakeB.data.score;
    const mergedX = (snakeA.data.x + snakeB.data.x) / 2;
    const mergedY = (snakeA.data.y + snakeB.data.y) / 2;
    
    // Update snake A with merged properties
    snakeA.data.radius = mergedRadius;
    snakeA.data.score = mergedScore;
    snakeA.data.x = mergedX;
    snakeA.data.y = mergedY;
    snakeA.data.speed = getSnakeSpeed(mergedScore);
    snakeA.data.splitFrom = null;
    snakeA.data.splitTime = 0;
    
    // Update physics body for snake A
    const oldBody = snakeA.physics.body;
    const newBody = Matter.Bodies.circle(
        mergedX,
        mergedY,
        mergedRadius,
        { 
            label: 'snake',
            isSensor: false, // Merged snake should have collision enabled
            uuid: snakeAId,
            inertia: Infinity, // Prevent rotation
            frictionAir: 0.1, // Add air friction for better control
            mass: 1, // Set consistent mass for all snakes regardless of size
        }
    );
    newBody.uuid = snakeAId;
    
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    snakeA.physics.body = newBody;
    
    // Remove snake B
    Matter.World.remove(physicsEngine.world, snakeB.physics.body);
    delete snakes[snakeBId];
    
    console.log(`Snakes ${snakeAId} and ${snakeBId} merged into ${snakeAId}`);
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
            uuid: pickUpId
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
    // Group snakes by username and sum their scores
    const playerScores = {};
    
    for (const snake of Object.values(snakes)) {
        const username = snake.data.username;
        if (!playerScores[username]) {
            playerScores[username] = 0;
        }
        playerScores[username] += snake.data.score;
    }
    
    // Convert to array and sort by total score
    const topPlayers = Object.entries(playerScores)
        .map(([username, totalScore]) => ({ username, totalScore }))
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
        
        if (labels.includes('snake') && labels.includes('pickup')) {
            const pickUpBody = bodyA.label === 'pickup' ? bodyA : bodyB;
            const snakeBody  = bodyA.label === 'snake' ? bodyA : bodyB;

            console.log('Pickup collected!', pickUpBody.id);
            
            growSnake(snakeBody.uuid);

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

        if (bodyA.label === 'snake' && bodyB.label === 'snake') {
            const snakeA = snakes[bodyA.uuid];
            const snakeB = snakes[bodyB.uuid];

            // Prevent player's own snakes from eating each other
            if (snakeA && snakeB && snakeA.data.username === snakeB.data.username) {
                continue;
            }

            if (circleContainsCircle(bodyA, bodyB)) {
                console.log(`${bodyA.uuid} fully contains ${bodyB.uuid}`);
                respawnSnake(bodyB.uuid, snakeB.data.username);
                growSnake(bodyA.uuid);
            }

            if (circleContainsCircle(bodyB, bodyA)) {
                console.log(`${bodyB.uuid} fully contains ${bodyA.uuid}`);
                respawnSnake(bodyA.uuid, snakeA.data.username);
                growSnake(bodyB.uuid);
            } 
        }
    }
});

// Unfortunately, we recreate the body because we can't change the radius of an existing circle body
function growSnake(snakeId) {
    const snake = snakes[snakeId];

    // Increase score
    snake.data.score += 1;

    // Increase radius
    snake.data.radius = getSnakeRadius(snake.data.score);

    // Decrease speed
    snake.data.speed = getSnakeSpeed(snake.data.score)

    const oldBody = snake.physics.body;

    const newBody = Matter.Bodies.circle(
        oldBody.position.x,
        oldBody.position.y,
        snake.data.radius,
        { 
            label: 'snake',
            isSensor: oldBody.isSensor, // Preserve the isSensor property
            uuid: snakeId,
            inertia: Infinity, // Prevent rotation
            frictionAir: 0.1, // Add air friction for better control
            mass: 1, // Set consistent mass for all snakes regardless of size
        }
    );

    newBody.uuid = snakeId;

    // Replace
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    snake.physics.body = newBody;
}

function getGrowthProgress(foodEaten, factor = 0.2) {
    return 1 - Math.exp(-factor * foodEaten); // smoothly goes from 0 to 1
}

function getSnakeRadius(foodEaten) {
    const progress = getGrowthProgress(foodEaten, 0.02); // tune factor as needed
    return MIN_SNAKE_RADIUS + (MAX_SNAKE_RADIUS - MIN_SNAKE_RADIUS) * progress;
}

function getSnakeSpeed(foodEaten) {
    const progress = getGrowthProgress(foodEaten, SNAKE_SPEED_GROWTH_FACTOR); // Much smaller factor for gradual speed decrease
    return MAX_SNAKE_SPEED - (MAX_SNAKE_SPEED - MIN_SNAKE_SPEED) * progress;
}

function respawnSnake(snakeId, username)
{
    Matter.World.remove(physicsEngine.world, snakes[snakeId].physics.body);
    snakes[snakeId] = initSnake(snakeId, username);
}

function handleSplit(snakeId, targetX, targetY) {
    const snake = snakes[snakeId];
    if (!snake) return;

    const currentTime = Date.now();
    const playerUsername = snake.data.username;
    
    // Find all snakes belonging to this player that are big enough to split
    const playerSnakes = Object.values(snakes).filter(s => 
        s.data.username === playerUsername && 
        s.data.radius >= MIN_SPLIT_RADIUS && 
        currentTime - s.data.lastSplitTime >= SPLIT_COOLDOWN
    );
    
    if (playerSnakes.length === 0) return; // No snakes can split

    // Split all eligible snakes
    for (const playerSnake of playerSnakes) {
        splitSingleSnake(playerSnake, targetX, targetY, currentTime);
    }
    
    console.log(`Split ${playerSnakes.length} snakes for player ${playerUsername}`);
}

function splitSingleSnake(snake, targetX, targetY, currentTime) {
    const snakeId = snake.data.id;
    
    // Calculate direction to target
    const dx = targetX - snake.data.x;
    const dy = targetY - snake.data.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance === 0) return; // Can't split if no direction
    
    let directionX = dx / distance;
    let directionY = dy / distance;

    // Create new snake (the split piece)
    const newSnakeId = uuidv4();
    const splitDistance = snake.data.radius * 1.5; // Distance between split pieces
    
    const newSnake = {
        data: {
            id: newSnakeId,
            x: snake.data.x + directionX * splitDistance,
            y: snake.data.y + directionY * splitDistance,
            radius: snake.data.radius * SPLIT_RATIO,
            targetX: targetX,
            targetY: targetY,
            speed: getSnakeSpeed(Math.floor(snake.data.score * SPLIT_RATIO)), // Use proper speed calculation
            color: snake.data.color,
            username: snake.data.username,
            score: Math.floor(snake.data.score * SPLIT_RATIO), // Split score proportionally
            lastSplitTime: currentTime,
            splitFrom: snake.data.id,
            splitTime: currentTime,
        }
    };

    newSnake.physics = {
        body: Matter.Bodies.circle(newSnake.data.x, newSnake.data.y, newSnake.data.radius, {
            label: 'snake',
            isSensor: false, // Start with collision enabled to prevent overlap
            uuid: newSnakeId,
            inertia: Infinity, // Prevent rotation
            frictionAir: 0.1, // Add air friction for better control
            mass: 1, // Set consistent mass for all snakes regardless of size
        })
    };

    // Update original snake
    snake.data.radius *= SPLIT_RATIO;
    snake.data.score = Math.floor(snake.data.score * SPLIT_RATIO);
    snake.data.speed = getSnakeSpeed(Math.floor(snake.data.score * SPLIT_RATIO));
    snake.data.lastSplitTime = currentTime;
    snake.data.splitFrom = snake.data.id;
    snake.data.splitTime = currentTime;

    // Update physics bodies
    const oldBody = snake.physics.body;
    const newBody = Matter.Bodies.circle(
        oldBody.position.x,
        oldBody.position.y,
        snake.data.radius,
        { 
            label: 'snake',
            isSensor: false, // Start with collision enabled to prevent overlap
            uuid: snakeId,
            inertia: Infinity, // Prevent rotation
            frictionAir: 0.1, // Add air friction for better control
            mass: 1, // Set consistent mass for all snakes regardless of size
        }
    );
    newBody.uuid = snakeId;

    // Replace original snake's body
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    snake.physics.body = newBody;

    // Add new snake to world
    Matter.World.add(physicsEngine.world, newSnake.physics.body);
    snakes[newSnakeId] = newSnake;

    // Apply impulse force to shoot the new snake towards the target position
    const impulseForce = 0.1; // Adjust this value for desired boost strength
    Matter.Body.applyForce(newSnake.physics.body, newSnake.physics.body.position, {
        x: directionX * impulseForce,
        y: directionY * impulseForce
    });

    console.log(`Snake ${snakeId} split into ${newSnakeId}`);
}

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
