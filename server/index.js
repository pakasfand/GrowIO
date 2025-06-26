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
const SNAKE_SPEED = 5;
const SNAKE_STARTING_RADIUS = 10;
const MAX_PICKUP_COUNT = 100;
const DEFAULT_PLAYER_USERNAME = "Player";
const LEADERBOARD_SIZE = 5;

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
            snakes[message.id].data.targetX = message.targetX;
            snakes[message.id].data.targetY = message.targetY;
        }
    });

    ws.on('close', () => {
        if (snakes[snakeId]) {
            console.log(`Player ${snakes[snakeId].data.username || 'Unknown'} (${snakeId}) disconnected`);
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
            radius: SNAKE_STARTING_RADIUS,
            targetX: startX,
            targetY: startY,
            speed: SNAKE_SPEED,
            color: Math.random() * 0xffffff,
            username: username,
            score: 0,
        }
    };

    snake.physics = {
        body: Matter.Bodies.circle(snake.data.x, snake.data.y, snake.data.radius, {
            label: 'snake',
            isSensor: true,
            uuid: snakeId
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

        const speed = snake.data.speed;
        Matter.Body.setVelocity(snakeBody, {
            x: direction.x * speed,
            y: direction.y * speed
        });
    }

    Matter.Engine.update(physicsEngine, PHYSICS_UPDATE_RATE);

    for (const id in snakes) {
        const snake = snakes[id];
        snake.data.x = snake.physics.body.position.x;
        snake.data.y = snake.physics.body.position.y;
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
    const topSnakeNames = Object.values(snakes)
        .map(s => s.data)
        .sort((a, b) => b.score - a.score)
        .slice(0, LEADERBOARD_SIZE);

    const leaderboard = topSnakeNames.map(s => ({
        username: s.username,
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

            if (circleContainsCircle(bodyA, bodyB)) {
                console.log(`${bodyA.uuid} fully contains ${bodyB.uuid}`);
                respawnSnake(bodyB.uuid);
                growSnake(bodyA.uuid);
            }

            if (circleContainsCircle(bodyB, bodyA)) {
                console.log(`${bodyB.uuid} fully contains ${bodyA.uuid}`);
                respawnSnake(bodyA.uuid);
                growSnake(bodyB.uuid);
            } 
        }
    }
});

// Unfortunately, we recreate the body because we can't change the radius of an existing circle body
function growSnake(snakeId) {
    const snake = snakes[snakeId];
    snake.data.radius *= 1.1;

    const oldBody = snake.physics.body;

    const newBody = Matter.Bodies.circle(
        oldBody.position.x,
        oldBody.position.y,
        snake.data.radius,
        { 
            label: 'snake',
            isSensor: true,
            uuid: snakeId
        }
    );

    newBody.uuid = snakeId;

    // Transfer velocity and angle
    Matter.Body.setVelocity(newBody, oldBody.velocity);
    Matter.Body.setAngle(newBody, oldBody.angle);
    Matter.Body.setAngularVelocity(newBody, oldBody.angularVelocity);

    // Replace
    Matter.World.remove(physicsEngine.world, oldBody);
    Matter.World.add(physicsEngine.world, newBody);
    snake.physics.body = newBody;

    // Increase score
    snake.data.score += 1;
}

function respawnSnake(snakeId)
{
    Matter.World.remove(physicsEngine.world, snakes[snakeId].physics.body);
    snakes[snakeId] = initSnake(snakeId);
}

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
