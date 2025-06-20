// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Matter = require('matter-js');
const { v4: uuidv4 } = require('uuid');

const PORT = 8080;
const STATE_UPDATE_RATE = 1000 / 60; // 60 FPS
const PICK_UP_SPAWN_RATE = 200;
const PICK_UP_RADIUS = 10;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve client files
app.use(express.static('public'));

// World and game data
const WORLD_SIZE = 5000;
const SNAKE_SPEED = 50;
const SNAKE_STARTING_RADIUS = 100;
// const SNAKE_LENGTH = 15;
// const SPACING = 2.5;
const MAX_PICKUP_COUNT = 1000;

const snakes = {};
const pickUps = {};

// TODOS: Spawn pick ups and allow snakes to eat them
var physicsEngine = Matter.Engine.create();

wss.on('connection', (ws) => {
    const id = uuidv4();
    const startX = WORLD_SIZE / 2 + Math.random() * 200 - 100;
    const startY = WORLD_SIZE / 2 + Math.random() * 200 - 100;
    snakes[id] = {
        data: {
            id: id,
            x: startX,
            y: startY,
            radius: SNAKE_STARTING_RADIUS,
            targetX: startX,
            targetY: startY,
            speed: SNAKE_SPEED,
            // trail: Array.from({ length: SNAKE_LENGTH }, (_, i) => ({ x: startX, y: startY + i * SPACING })),
            color: Math.random() * 0xffffff,
        }
    };

    let snakeData = snakes[id].data;
    snakes[id].physics = {
        body: Matter.Bodies.circle(snakeData.x, snakeData.y, snakeData.radius, {
            label: 'snake',
            isSensor: false,
            inertia: Infinity,       // Prevent rotation
            frictionAir: 0,          // No drag
        })  
    }

    snakes[id].debug = {
        physicsBodyXPosition: snakes[id].physics.body.position.x,
        physicsBodyYPosition: snakes[id].physics.body.position.y,
    }

    Matter.World.add(physicsEngine.world, snakes[id].physics.body);

    ws.send(JSON.stringify(
    { 
        type: 'init', 
        playerId: id,
        allSnakeData: Object.fromEntries(Object.entries(snakes).map(([id, snake]) => [id, {
            ...snake.data,
            debug: snake.debug,
        }])),
    }));

    ws.on('message', (msg) => {
        // console.log(`Received message from ${id}: ${msg}`);
        const data = JSON.parse(msg);
        if (data.type === 'input') {
            snakes[data.id].data.targetX = data.targetX;
            snakes[data.id].data.targetY = data.targetY;
            // console.log(data);
        }
    });

    ws.on('close', () => {
        delete snakes[id];
    });

});

setInterval(() => {
    for (const id in snakes) {
        var targetPosition = Matter.Vector.create(snakes[id].data.targetX, snakes[id].data.targetY);
        var snakePosition = Matter.Vector.create(snakes[id].data.x, snakes[id].data.y);
        var directionVector = Matter.Vector.sub(targetPosition, snakePosition);

        // To avoid the snake from moving continously towards the target 
        // we check if the distance is greater than an arbitray threshold
        if (Matter.Vector.magnitude(directionVector) > 5) 
        {
            var normalizedDirectionVector = Matter.Vector.normalise(directionVector);

            snakes[id].data.x = snakePosition.x + normalizedDirectionVector.x * SNAKE_SPEED / 20;
            snakes[id].data.y = snakePosition.y + normalizedDirectionVector.y * SNAKE_SPEED / 20;
            
            Matter.Body.setPosition(snakes[id].physics.body, 
                Matter.Vector.create(snakes[id].data.x, snakes[id].data.y));
            
            // snakes[id].physics.body.position.x = snakes[id].data.x;
            // snakes[id].physics.body.position.y = snakes[id].data.y;

            snakes[id].debug.physicsBodyXPosition = snakes[id].physics.body.position.x;
            snakes[id].debug.physicsBodyYPosition = snakes[id].physics.body.position.y;

            // console.log(`Snake ${id} moving to target: ${snakes[id].targetX}, ${snakes[id].targetY}`);
        }
    }

    Matter.Engine.update(physicsEngine, STATE_UPDATE_RATE);

    const payload = JSON.stringify({
        type: 'state',
        allSnakeData: Object.fromEntries(Object.entries(snakes).map(([id, snake]) => [id, {
            ...snake.data,
            debug: snake.debug,
        }])),
        pickUps: Object.fromEntries(Object.entries(pickUps).map(([id, p]) => [id, p.data])),
    });

    // console.log(payload);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, STATE_UPDATE_RATE);

function randPos() {
    return Math.random() * WORLD_SIZE;
}

setInterval(() => {
    if (Object.keys(pickUps).length >= MAX_PICKUP_COUNT) return;

    const pickUp = {
        data: {
            id: uuidv4(),
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
        })
    }

    pickUp.physics.body.uuid = pickUp.data.id;

    Matter.World.add(physicsEngine.world, [pickUp.physics.body]);

    pickUps[pickUp.id] = pickUp;

}, PICK_UP_SPAWN_RATE);

Matter.Events.on(physicsEngine, 'collisionStart', (event) => {
    for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        
        // console.log('Colliding objects positions:', bodyA.position, bodyB.position);

        const labels = [bodyA.label, bodyB.label];

        if (labels.includes('snake') && labels.includes('pickup')) {
            const pickUpBody = bodyA.label === 'pickup' ? bodyA : bodyB;
            console.log('Pickup collected!', pickUpBody.id);
            
            const payload = JSON.stringify({
                type: 'removePickUp',
                pickUpId: pickUpBody.uuid,
            });
            
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(payload);
                }
            });
            
            // Remove pickup from world and your pickUps object
            Matter.World.remove(physicsEngine.world, pickUpBody);
            delete pickUps[pickUpBody.id];
        }
    }
});

// Matter.Events.on(physicsEngine, 'collisionActive', (event) => {
//     for (const pair of event.pairs) {
//         const { bodyA, bodyB } = pair;
        
//         // console.log('Colliding objects positions:', bodyA.position, bodyB.position);

//         const labels = [bodyA.label, bodyB.label];

//         if (labels.includes('snake') && labels.includes('pickup')) {
//             const pickupBody = bodyA.label === 'pickup' ? bodyA : bodyB;
//             console.log('Pickup collected!', pickupBody.id);

//             // Remove pickup from world and your pickUps object
//             Matter.World.remove(physicsEngine.world, pickupBody);
//             delete pickUps[pickupBody.id];
//         }
//     }
// });

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
