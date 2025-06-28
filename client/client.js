import { Scene } from "phaser";
import config from './config.js';

export class MainScene extends Scene {
    constructor() {
        super({ key: "MainScene" });
    }
    
    create() {
        this.worldSize = new Phaser.Math.Vector2(5000, 5000);

        // Draw grid lines
        const gridSize = 100; // Size of each grid cell
        const gridGraphics = this.add.graphics();
        gridGraphics.lineStyle(1, 0x444444, 0.5); // Gray lines, semi-transparent

        // Vertical lines
        for (let x = 0; x <= this.worldSize.x; x += gridSize) {
            gridGraphics.beginPath();
            gridGraphics.moveTo(x, 0);
            gridGraphics.lineTo(x, this.worldSize.y);
            gridGraphics.strokePath();
        }

        // Horizontal lines
        for (let y = 0; y <= this.worldSize.y; y += gridSize) {
            gridGraphics.beginPath();
            gridGraphics.moveTo(0, y);
            gridGraphics.lineTo(this.worldSize.x, y);
            gridGraphics.strokePath();
        }
        gridGraphics.setDepth(-1); // Ensure grid is behind everything
        
        this.cameras.main.setBackgroundColor('#ffffff');
        
        // Create FPS counter
        this.fpsText = this.add.text(10, 10, '', {
            font: '16px Courier',
            fill: '#00ff00',
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 }
        });
        this.fpsText.setScrollFactor(0);
        this.fpsText.setDepth(1000);
        this.fpsText.setPosition(10, 10); // Ensure it's at screen coordinates

        // Create username display
        this.playerUsernameText = this.add.text(10, 35, '', {
            font: '14px Arial',
            fill: '#ffffff',
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 }
        });
        this.playerUsernameText.setScrollFactor(0);
        this.playerUsernameText.setDepth(1000);
        this.playerUsernameText.setPosition(10, 35); // Ensure it's at screen coordinates
        this.defaultPlayerUsername = "Player";

        // Create split indicator
        this.splitIndicatorText = this.add.text(10, 60, 'Press SPACE to split', {
            font: '12px Arial',
            fill: '#00ff00',
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 }
        });
        this.splitIndicatorText.setScrollFactor(0);
        this.splitIndicatorText.setDepth(1000);
        this.splitIndicatorText.setPosition(10, 60); // Ensure it's at screen coordinates
        this.splitIndicatorText.setVisible(false);

        // Create leaderboard
        this.leaderboardText = this.add.text(
            this.game.config.width - 20, // x (right edge)
            20,                          // y (top)
            '',                          // initial text
            {
                font: '16px Arial',
                fill: '#222',
                align: 'left',
                backgroundColor: 'rgba(255,255,255,0.7)',
                padding: { x: 8, y: 6 }
            }
        );
        this.leaderboardText.setOrigin(1, 0); // right align
        this.leaderboardText.setScrollFactor(0);
        this.leaderboardText.setDepth(1000);
        this.leaderboard = [];

        // Use configuration for server connection
        this.socket = new WebSocket(config.serverUrl);
        this.playerId;
        this.snakes = {};
        this.snakeIds = new Set();
        this.playerSnakeData;
        this.playerSnake = new Phaser.GameObjects.Container(this, 0, 0);

        this.pickUps = {};
        this.pickUpIds = new Set();

        // Send username with connection
        this.socket.addEventListener('open', () => {
            const username = window.playerUsername || this.defaultPlayerUsername;
            this.socket.send(JSON.stringify({
                type: 'connect',
                username: username
            }));
        });

        this.socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'init') {
                this.playerId = msg.playerId;
                console.log(`Connected as ${this.playerId}`);

                for (const [snakeId, snakeData] of Object.entries(msg.allSnakeData)) {
                    this.snakes[snakeData.id] = this.initSnake(snakeData);
                }

                this.snakeIds = new Set(Object.keys(msg.allSnakeData));
                
                // Set camera bounds
                this.cameras.main.setBounds(0, 0, this.worldSize.x, this.worldSize.y);
                
                // Set player username
                const playerUsername = window.playerUsername || this.defaultPlayerUsername;
                if (this.playerUsernameText) {
                    this.playerUsernameText.setText(`Playing as: ${playerUsername}`);
                }
            }

            if (msg.type === 'state') {
                
                // Synchronize snakes
                const stateSnakeIds = new Set(Object.keys(msg.allSnakeData));
                const snakeIdsToSpawn = stateSnakeIds.difference(this.snakeIds);
                const snakeIdsToRemove = this.snakeIds.difference(stateSnakeIds);
                this.snakeIds = stateSnakeIds;

                for (const snakeId of snakeIdsToSpawn) {
                    this.snakes[snakeId] = this.initSnake(msg.allSnakeData[snakeId]);
                }

                for (const snakeId of snakeIdsToRemove) {
                    if (this.snakes[snakeId] && this.snakes[snakeId].container) {
                        this.snakes[snakeId].container.first.destroy();
                        this.snakes[snakeId].container.destroy();
                    }
                    delete this.snakes[snakeId];
                    console.log(`Removing snake with if ${snakeId}`)
                }
                
                // Update snake properties
                for(const snakeId of stateSnakeIds)
                {
                    const snakeData = msg.allSnakeData[snakeId];
                    const snake = this.snakes[snakeId];

                    snake.lastX = snake.x;
                    snake.lastY = snake.y;

                    snake.x = snakeData.x;
                    snake.y = snakeData.y;
                    
                    snake.lerpAlpha = 0;
                    
                    // Update snake visual as snake has grown
                    if (snake.radius !== snakeData.radius) {
                        snake.radius = snakeData.radius;
                        const graphics = snake.container.first;
                        if (graphics) {
                            graphics.clear();
                            graphics.fillStyle(snake.color, 1);
                            graphics.fillCircle(0, 0, snake.radius);
                        }

                        const snakeOutline = snake.container.getAt(1);
                        if (snakeOutline) {
                            snakeOutline.clear();
                            snakeOutline.lineStyle(1, 0x000000, 1);
                            snakeOutline.strokeCircle(0, 0, snake.radius);
                        }
                        
                        // Update username position when snake grows
                        const usernameText = snake.container.getAt(2);
                        if (usernameText) {
                            usernameText.setPosition(0, -snake.radius - 15);
                        }
                    }
                }
                
                // Check if any player snake is big enough to split
                const playerSnakes = Object.values(this.snakes).filter(s => s.username === (window.playerUsername || this.defaultPlayerUsername));
                const canSplit = playerSnakes.some(s => s.radius >= 35); // Match server's MIN_SPLIT_RADIUS
                this.splitIndicatorText.setVisible(canSplit);
                
                // Synchronize pickups
                const statePickUpIds = new Set(Object.keys(msg.pickUps));
                const pickUpsIdsToSpawn = statePickUpIds.difference(this.pickUpIds);
                const pickUpsIdsToRemove = this.pickUpIds.difference(statePickUpIds);
                this.pickUpIds = statePickUpIds;

                for (const pickUpId of pickUpsIdsToSpawn) {
                    this.pickUps[pickUpId] = this.initPickUp(msg.pickUps[pickUpId]);
                }

                for (const pickUpId of pickUpsIdsToRemove) {
                    if (this.pickUps[pickUpId] && this.pickUps[pickUpId].container) {
                        this.pickUps[pickUpId].container.first.destroy();
                        this.pickUps[pickUpId].container.destroy();
                    }
                    delete this.pickUps[pickUpId];
                }
            }

            if (msg.type === 'leaderboard') {
                this.leaderboard = msg.leaderboard;

                let text = 'Leaderboard\n';
                this.leaderboard.forEach((entry, i) => {
                    text += `${i + 1}. ${entry.username} (${entry.totalScore})\n`;
                });
                this.leaderboardText.setText(text);
            }
        });

        this.time.addEvent({
            delay: 1/10 * 1000,
            callback: () => {
                this.sendMouseInput();
            },
            callbackScope: this,
            loop: true
        });

        // Add split input handler
        this.input.keyboard.on('keydown-SPACE', () => {
            this.sendSplitInput();
        });
    }

    update(time, delta) {
        this.fpsText.setText(`FPS: ${Math.floor(this.game.loop.actualFps)}`);

        const alphaStep = delta / (1000 / 30); // Fixed to match server's 30Hz

        for (const snake of Object.values(this.snakes)) {
            if (snake.lerpAlpha === undefined) continue;

            snake.lerpAlpha = Math.min(snake.lerpAlpha + alphaStep, 1);

            const interpX = Phaser.Math.Linear(snake.lastX, snake.x, snake.lerpAlpha);
            const interpY = Phaser.Math.Linear(snake.lastY, snake.y, snake.lerpAlpha);
            snake.container.setPosition(interpX, interpY);
        }

        // Camera follows the midpoint of all player-controlled snakes
        const playerSnakes = Object.values(this.snakes).filter(s => s.username === (window.playerUsername || this.defaultPlayerUsername));
        if (playerSnakes.length > 0) {
            let sumX = 0, sumY = 0;
            for (const s of playerSnakes) {
                sumX += s.container.x;
                sumY += s.container.y;
            }
            const midX = sumX / playerSnakes.length;
            const midY = sumY / playerSnakes.length;
            
            // Smooth camera following
            this.cameras.main.pan(midX, midY, 100, 'Linear', true);
        }
    }
    
    initSnake(snakeData)
    {
        let snake = {
            id: snakeData.id,
            x: snakeData.x,
            y: snakeData.y,
            lastX: snakeData.x,
            lastY: snakeData.y,
            targetX: snakeData.targetX,
            targetY: snakeData.targetY,
            color: snakeData.color,
            radius: snakeData.radius,
            username: snakeData.username || this.defaultPlayerUsername,
            container: new Phaser.GameObjects.Container(this, snakeData.x, snakeData.y),
        };
        
        this.add.existing(snake.container);
        const snakeCircle = this.add.graphics();
        snakeCircle.fillStyle(snake.color, 1);
        snakeCircle.fillCircle(0, 0, snake.radius);
        snakeCircle.setPosition(0, 0);
        snake.container.add(snakeCircle);

        const snakeOutline = this.add.graphics();
        snakeOutline.lineStyle(1, 0x000000, 1);
        snakeOutline.strokeCircle(0, 0, snake.radius);
        snakeOutline.setPosition(0, 0);
        snake.container.add(snakeOutline);

        // Add username text above the snake
        const usernameText = this.add.text(0, -snake.radius - 15, snake.username, {
            font: '12px Arial',
            fill: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2,
            padding: { x: 4, y: 2 }
        });
        usernameText.setOrigin(0.5, 0.5);
        snake.container.add(usernameText);

        return snake;
    }

    initPickUp(pickUpData)
    {
        let pickUp = {
            id: pickUpData.id,
            x: pickUpData.x,
            y: pickUpData.y,
            color: pickUpData.color,
            radius: pickUpData.radius,
            container: new Phaser.GameObjects.Container(this, pickUpData.x, pickUpData.y),
        };
        
        this.add.existing(pickUp.container);
        const pickUpCircle = this.add.graphics();
        pickUpCircle.fillStyle(pickUp.color, 1);
        pickUpCircle.fillCircle(0, 0, pickUp.radius);
        pickUpCircle.setPosition(0, 0);
        pickUp.container.add(pickUpCircle);

        return pickUp;
    }
    
    sendMouseInput() {
        if(!this.playerId || this.socket.readyState !== WebSocket.OPEN) {return;}

        const pointer = this.input.activePointer;
        const mouseWorldPosition = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.socket.send(JSON.stringify({
            type: 'input',
            id: this.playerId,
            targetX: mouseWorldPosition.x,
            targetY: mouseWorldPosition.y
        }))
    }

    sendSplitInput() {
        if(!this.playerId || this.socket.readyState !== WebSocket.OPEN) {return;}

        const pointer = this.input.activePointer;
        const mouseWorldPosition = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.socket.send(JSON.stringify({
            type: 'split',
            id: this.playerId,
            targetX: mouseWorldPosition.x,
            targetY: mouseWorldPosition.y
        }));
    }
}