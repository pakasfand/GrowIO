import { Scene } from "phaser";

export class MainScene extends Scene {
    constructor() {
        super({ key: "MainScene" });
    }
    
    preload() {
        this.load.image('pattern', 'assets/background-tile.png');
    }
    
    create() {
        this.worldSize = new Phaser.Math.Vector2(5000, 5000);

        this.tile = this.add.tileSprite(0, 0, this.worldSize.x, this.worldSize.y, 'pattern')
            .setOrigin(0, 0);

        // Follow snake container
        // this.cameras.main.startFollow(this.playerSnake, true, 1, 1);
        // this.cameras.main.setBounds(0, 0, this.worldSize.x, this.worldSize.y);
        
        // Create FPS counter
        this.fpsText = this.add.text(0, 0, '', {
            font: '16px Courier',
            fill: '#00ff00'
        });
        this.fpsText.setScrollFactor(0);
        this.fpsText.setDepth(1000);

        this.socket = new WebSocket(`ws://localhost:8080`);
        this.playerId;
        this.snakes = {};
        this.playerSnakeData;
        this.playerSnake = new Phaser.GameObjects.Container(this, 0, 0);

        this.pickUps = {};

        this.socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'init') {
                this.playerId = msg.playerId;
                console.log(`Connected as ${this.playerId}`);

                for (const [snakeId, snakeData] of Object.entries(msg.allSnakeData)) {
                    this.snakes[snakeData.id] = this.initSnake(snakeData);
                    // console.log(`${key}: ${value}`);
                }

                this.cameras.main.startFollow(this.snakes[this.playerId].container, true, 1, 1);
                this.cameras.main.setBounds(0, 0, this.worldSize.x, this.worldSize.y);
            }

            if (msg.type === 'state') {
                for (const [snakeId, snakeData] of Object.entries(msg.allSnakeData)) {
                    if(!this.snakes[snakeData.id]) {
                        this.snakes[snakeData.id] = this.initSnake(snakeData);
                    }

                    const snake = this.snakes[snakeData.id];

                    snake.lastX = snake.x;
                    snake.lastY = snake.y;

                    snake.x = snakeData.x;
                    snake.y = snakeData.y;
                    
                    snake.lerpAlpha = 0;
                    
                    snake.debugContainer.setPosition(snakeData.debug.physicsBodyXPosition, snakeData.debug.physicsBodyYPosition);
                    // console.log("Physics body position", snakeData.debug.physicsBodyXPosition, snakeData.debug.physicsBodyYPosition);
                }

                for (const [pickUpId, pickUpData] of Object.entries(msg.pickUps)) {
                    if(!this.pickUps[pickUpData.id]) {
                        this.pickUps[pickUpData.id] = this.initPickUp(pickUpData);
                    }
                }

                // for (const localId of Object.keys(this.pickUps)) {
                //     if (!(localId in msg.pickUps)) {
                //         this.pickUps[localId].container.destroy();
                //         delete this.pickUps[localId];
                //     }
                // }
            }

            if(msg.type === "removePickUp")
            {
                let pickUpId = msg.pickUpId;
                if (pickUpId && this.pickUps[pickUpId])
                {
                    console.log(`Removing PickUp ID: ${pickUpId}`)
                    this.pickUps[pickUpId].container.destroy();
                    delete this.pickUps[pickUpId]
                }
            }
        });

        this.time.addEvent({
            delay: 1/30 * 1000,
            callback: () => {
                this.sendMouseInput();
            },
            callbackScope: this,
            loop: true
        });
    }

    update(time, delta) {
        this.fpsText.setText(`FPS: ${Math.floor(this.game.loop.actualFps)}`);

        const alphaStep = delta / (1000 / 20); // assumes server sends at 20Hz (50ms interval)

        for (const snake of Object.values(this.snakes)) {
            if (snake.lerpAlpha === undefined) continue;

            snake.lerpAlpha = Math.min(snake.lerpAlpha + alphaStep, 1);

            const interpX = Phaser.Math.Linear(snake.lastX, snake.x, snake.lerpAlpha);
            const interpY = Phaser.Math.Linear(snake.lastY, snake.y, snake.lerpAlpha);
            snake.container.setPosition(interpX, interpY);
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
            debug: snakeData.debug,
            container: new Phaser.GameObjects.Container(this, snakeData.x, snakeData.y),
            debugContainer: new Phaser.GameObjects.Container(this, snakeData.x, snakeData.y),
        };
        
        this.add.existing(snake.container);
        const snakeCircle = this.add.graphics();
        snakeCircle.fillStyle(0xffffff, 1);
        snakeCircle.fillCircle(0, 0, snake.radius);
        snakeCircle.setPosition(0, 0);
        snake.container.add(snakeCircle);

        this.add.existing(snake.debugContainer);
        const debugCircle = this.add.graphics();
        // debugCircle.stroke(0xff0000, 1);
        debugCircle.lineStyle(2, 0xff0000, 1);
        debugCircle.strokeCircle(0, 0, snake.radius);
        debugCircle.setPosition(0, 0);
        snake.debugContainer.add(debugCircle);

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

        const debugCircle = this.add.graphics();
        // debugCircle.stroke(0xff0000, 1);
        debugCircle.lineStyle(2, 0xff0000, 1);
        debugCircle.strokeCircle(0, 0, pickUp.radius);
        debugCircle.setPosition(0, 0);

        pickUp.container.add(pickUpCircle);
        pickUp.container.add(debugCircle);

        return pickUp;
    }
    
    sendMouseInput() {
        if(!this.playerId || this.socket.readyState !== WebSocket.OPEN) {return;}

        const pointer = this.input.activePointer;
        const mouseWorldPosition = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

        // console.log('Sending mouse input');

        this.socket.send(JSON.stringify({
            type: 'input',
            id: this.playerId,
            targetX: mouseWorldPosition.x,
            targetY: mouseWorldPosition.y
        }))
    }
}