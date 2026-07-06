const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Game State
let score = 0;
let highScore = localStorage.getItem("galagaHighScore") || 0;
let lives = 3;
let gameOver = false;
let stars = [];
let lastTime = 0;

// Audio Assets
const shootSound = new Audio('assets/audio/shoot.wav');
shootSound.volume = 0.5;
const explosionSound = new Audio('assets/audio/explosion.wav');
explosionSound.volume = 0.5;

function playSound(audioEl) {
    // Clone node to allow rapid overlapping sounds
    const sound = audioEl.cloneNode();
    sound.play().catch(e => console.log("Audio play prevented:", e));
}

// Sprite Assets
const playerImg = new Image();
playerImg.src = 'assets/sprites/player.png';

const enemyImg = new Image();
enemyImg.src = 'assets/sprites/enemy.png';

// Initialize stars
for (let i = 0; i < 50; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2,
        speed: (Math.random() * 2 + 1) * 60 // px per second
    });
}

// Player
const player = {
    x: canvas.width / 2 - 15,
    y: canvas.height - 50,
    width: 30,
    height: 30,
    speed: 300, // px per second
    cooldown: 0
};

let keys = {};
let bullets = [];
let enemyBullets = [];
let enemies = [];

// Enemies
const enemyRows = 4;
const enemyCols = 8;
const enemyWidth = 24;
const enemyHeight = 24;
let enemyDirection = 1; 
let enemyBaseSpeed = 90; // px per second
let wave = 1;
let enemyAttackTimer = 2.0;

function initEnemies() {
    enemies = [];
    for (let row = 0; row < enemyRows; row++) {
        for (let col = 0; col < enemyCols; col++) {
            enemies.push({
                startX: col * (enemyWidth + 15) + 50,
                startY: row * (enemyHeight + 15) + 60,
                x: col * (enemyWidth + 15) + 50,
                y: row * (enemyHeight + 15) + 60,
                width: enemyWidth,
                height: enemyHeight,
                alive: true,
                state: 'formation', // formation or diving
                attackTimer: 0,
                t: 0 // For bezier interpolation
            });
        }
    }
}

// Input Handling
window.addEventListener("keydown", e => keys[e.code] = true);
window.addEventListener("keyup", e => keys[e.code] = false);

// Touch Controls
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.getElementById('touchControls').style.display = 'flex';
    
    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');
    const btnFire = document.getElementById('btnFire');

    btnLeft.addEventListener("touchstart", e => { e.preventDefault(); keys["ArrowLeft"] = true; });
    btnLeft.addEventListener("touchend", e => { e.preventDefault(); keys["ArrowLeft"] = false; });
    
    btnRight.addEventListener("touchstart", e => { e.preventDefault(); keys["ArrowRight"] = true; });
    btnRight.addEventListener("touchend", e => { e.preventDefault(); keys["ArrowRight"] = false; });

    btnFire.addEventListener("touchstart", e => { e.preventDefault(); keys["Space"] = true; });
    btnFire.addEventListener("touchend", e => { e.preventDefault(); keys["Space"] = false; });
}

window.addEventListener("keydown", e => {
    if (gameOver && e.code === "Space") {
        resetGame();
    }
});

// For touch game over reset
canvas.addEventListener("touchstart", e => {
    if (gameOver) {
        resetGame();
    }
});

function resetGame() {
    score = 0;
    lives = 3;
    wave = 1;
    enemyAttackTimer = 2.0;
    enemyBaseSpeed = 90;
    gameOver = false;
    initEnemies();
    bullets = [];
    enemyBullets = [];
    player.x = canvas.width / 2 - 15;
    lastTime = performance.now();
}

// Cubic Bezier interpolation
function bezier(t, p0, p1, p2, p3) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
}

function update(deltaTime) {
    if (gameOver) return;

    // 1. Stars
    stars.forEach(star => {
        star.y += star.speed * deltaTime;
        if (star.y > canvas.height) {
            star.y = 0;
            star.x = Math.random() * canvas.width;
        }
    });

    // 2. Player
    if (keys["ArrowLeft"] && player.x > 0) player.x -= player.speed * deltaTime;
    if (keys["ArrowRight"] && player.x < canvas.width - player.width) player.x += player.speed * deltaTime;

    // Shoot
    if (player.cooldown > 0) player.cooldown -= deltaTime;
    if (keys["Space"] && player.cooldown <= 0) {
        bullets.push({ x: player.x + player.width / 2 - 2, y: player.y, width: 4, height: 10, speed: 420 });
        player.cooldown = 0.25; // Seconds
        playSound(shootSound);
    }

    // 3. Player Bullets
    bullets.forEach((bullet, bIndex) => {
        bullet.y -= bullet.speed * deltaTime;
        if (bullet.y < 0) bullets.splice(bIndex, 1);
    });

    // 4. Enemies
    let hitWall = false;

    // Countdown attack timer
    enemyAttackTimer -= deltaTime;
    let timeBetweenAttacks = Math.max(0.5, 3.0 - (wave * 0.2) - (score * 0.0005));
    let startDiving = false;
    if (enemyAttackTimer <= 0) {
        startDiving = true;
        enemyAttackTimer = timeBetweenAttacks;
    }
    
    let formationEnemies = [];

    enemies.forEach(enemy => {
        if (!enemy.alive) return;

        if (enemy.state === 'formation') {
            formationEnemies.push(enemy);
            enemy.startX += enemyBaseSpeed * enemyDirection * deltaTime;
            enemy.x = enemy.startX;
            enemy.y = enemy.startY;
            
            if (enemy.x + enemy.width > canvas.width - 10 || enemy.x < 10) {
                hitWall = true;
            }
        } else if (enemy.state === 'diving') {
            enemy.t += 0.5 * deltaTime; // Dive speed
            if (enemy.t > 1) {
                // Return to formation
                enemy.state = 'formation';
                enemy.y = enemy.startY;
            } else {
                // Simple dive path (p0=start, p1=forward, p2=near player, p3=loop back)
                let p0x = enemy.startX, p0y = enemy.startY;
                let p3x = enemy.startX, p3y = 0; // Return through the top
                let p1x = p0x + 100 * enemyDirection, p1y = p0y + 150;
                let p2x = player.x, p2y = player.y + 50;

                enemy.x = bezier(enemy.t, p0x, p1x, p2x, p3x);
                enemy.y = bezier(enemy.t, p0y, p1y, p2y, p3y);

                // Shoot while diving
                if (Math.random() < 0.02) {
                    enemyBullets.push({ x: enemy.x + enemy.width/2, y: enemy.y + enemy.height, width: 4, height: 10, speed: 250 });
                }
            }
        }
        
        // Random shots from formation
        if (enemy.state === 'formation' && Math.random() < 0.0005) { 
            enemyBullets.push({ x: enemy.x + enemy.width/2, y: enemy.y + enemy.height, width: 4, height: 10, speed: 200 });
        }
    });

    if (startDiving && formationEnemies.length > 0) {
        let attacker = formationEnemies[Math.floor(Math.random() * formationEnemies.length)];
        attacker.state = 'diving';
        attacker.t = 0;
    }

    if (hitWall) {
        enemyDirection *= -1;
        enemies.forEach(enemy => {
            if(enemy.state === 'formation') {
                enemy.startY += 10;
            }
        }); 
    }

    // 5. Enemy Bullets
    enemyBullets.forEach((eb, ebIndex) => {
        eb.y += eb.speed * deltaTime;
        if (eb.y > canvas.height) enemyBullets.splice(ebIndex, 1);

        if (eb.x < player.x + player.width &&
            eb.x + eb.width > player.x &&
            eb.y < player.y + player.height &&
            eb.y + eb.height > player.y) {
            
            enemyBullets.splice(ebIndex, 1);
            lives--;
            playSound(explosionSound);
            if (lives <= 0) triggerGameOver();
        }
    });

    // 6. Collisions (Bullets vs Enemies)
    bullets.forEach((bullet, bIndex) => {
        enemies.forEach(enemy => {
            if (!enemy.alive) return;

            if (bullet.x < enemy.x + enemy.width &&
                bullet.x + bullet.width > enemy.x &&
                bullet.y < enemy.y + enemy.height &&
                bullet.y + bullet.height > enemy.y) {
                
                enemy.alive = false;
                bullets.splice(bIndex, 1);
                score += 100;
                playSound(explosionSound);
            }
        });
    });

    // Wave completed
    if (enemies.every(e => !e.alive)) {
        wave++;
        enemyBaseSpeed += 20; // Harder
        initEnemies();
    }

    // Enemies touch player
    enemies.forEach(enemy => {
        if (enemy.alive && 
            enemy.x < player.x + player.width &&
            enemy.x + enemy.width > player.x &&
            enemy.y < player.y + player.height &&
            enemy.y + enemy.height > player.y) {
            triggerGameOver();
        }
    });
}

function triggerGameOver() {
    gameOver = true;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem("galagaHighScore", highScore);
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background Stars
    ctx.fillStyle = "white";
    stars.forEach(star => {
        ctx.fillRect(star.x, star.y, star.size, star.size);
    });

    if (gameOver) {
        ctx.fillStyle = "red";
        ctx.font = "30px 'Courier New'";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
        ctx.fillStyle = "white";
        ctx.font = "16px 'Courier New'";
        ctx.fillText("Presiona ESPACIO o TOCA para reiniciar", canvas.width / 2, canvas.height / 2 + 40);
        return;
    }

    // Player (Use image if loaded, else fallback to rect)
    if (playerImg.complete && playerImg.naturalWidth !== 0) {
        ctx.drawImage(playerImg, player.x, player.y, player.width, player.height);
    } else {
        ctx.fillStyle = "#00ffcc";
        ctx.fillRect(player.x, player.y, player.width, player.height);
    }

    // Enemies
    enemies.forEach(enemy => {
        if (!enemy.alive) return;
        if (enemyImg.complete && enemyImg.naturalWidth !== 0) {
            ctx.drawImage(enemyImg, enemy.x, enemy.y, enemy.width, enemy.height);
        } else {
            ctx.fillStyle = enemy.state === 'diving' ? "#ff00ff" : "#ff0055";
            ctx.fillRect(enemy.x, enemy.y, enemy.width, enemy.height);
        }
    });

    // Player Bullets
    ctx.fillStyle = "#ffff00";
    bullets.forEach(bullet => {
        ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
    });

    // Enemy Bullets
    ctx.fillStyle = "#ff00ff";
    enemyBullets.forEach(eb => {
        ctx.fillRect(eb.x, eb.y, eb.width, eb.height);
    });

    // UI
    ctx.fillStyle = "white";
    ctx.font = "16px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillText(`SCORE: ${score}`, 10, 25);
    ctx.textAlign = "center";
    ctx.fillText(`HI: ${highScore}`, canvas.width / 2, 25);
    ctx.textAlign = "right";
    ctx.fillText(`LIVES: ${"♥".repeat(lives)}`, canvas.width - 10, 25);
}

function gameLoop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let deltaTime = (timestamp - lastTime) / 1000;
    
    // Cap deltaTime to prevent huge jumps if tab was inactive
    if (deltaTime > 0.1) deltaTime = 0.1; 
    
    lastTime = timestamp;

    update(deltaTime);
    draw();
    requestAnimationFrame(gameLoop);
}

// Start
initEnemies();
requestAnimationFrame(gameLoop);
