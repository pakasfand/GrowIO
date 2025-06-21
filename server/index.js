// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Matter = require('matter-js');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PHYSICS_UPDATE_RATE = 1000 / 60; // 60 FPS
const STATE_UPDATE_RATE = 1000 / 30; // 30 FPS
const PICK_UP_SPAWN_RATE = 200;
const PICK_UP_RADIUS = 5;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve client files
app.use(express.static('dist'));
app.use(express.static('public')); // Fallback for assets

// World and game data
const WORLD_SIZE = 5000;
const SNAKE_SPEED = 5;
const SNAKE_STARTING_RADIUS = 10;
const MAX_PICKUP_COUNT = 100;

const snakes = {};
const pickUps = {};

var physicsEngine = Matter.Engine.create();
physicsEngine.gravity.x = 0;
physicsEngine.gravity.y = 0;

wss.on('connection', (ws) => {
    const snakeId = uuidv4();
    snakes[snakeId] = initSnake(snakeId);

    ws.send(JSON.stringify(
    { 
        type: 'init', 
        playerId: snakeId,
        allSnakeData: Object.fromEntries(Object.entries(snakes).map(([id, snake]) => [id, snake.data])),
    }));

    ws.on('message', (msg) => {
        const snakeDataId = JSON.parse(msg);
        if (snakeDataId.type === 'input') {
            snakes[snakeDataId.id].data.targetX = snakeDataId.targetX;
            snakes[snakeDataId.id].data.targetY = snakeDataId.targetY;
        }
    });

    ws.on('close', () => {
        delete snakes[snakeId];
    });
});

function initSnake(snakeId)
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
        }
    };

    snake.physics = {
        body: Matter.Bodies.circle(snake.data.x, snake.data.y, snake.data.radius, {
            label: 'snake',
            isSensor: false,
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

    // Unfortunately, we recreate the body because we can't change the radius of an existing circle body
    function growSnake(snakeId) {
        const snake = snakes[snakeId];
        snake.data.radius *= 1.1;

        const oldBody = snake.physics.body;

        const newBody = Matter.Bodies.circle(
            oldBody.position.x,
            oldBody.position.y,
            snake.data.radius,
            { label: 'snake' }
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
    }

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});
