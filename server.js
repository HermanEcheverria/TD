const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Game World Constants
const MAP_SIZE = 2000;
const TOWER_RADIUS = 36;
const COLOR_PALETTE = [
  '#FF4757', // Coral Red
  '#2ED573', // Emerald Green
  '#1E90FF', // Dodge Blue
  '#FFA502', // Orange
  '#9B59B6', // Amethyst Purple
  '#FF6B81', // Neon Pink
  '#70A1FF', // Sky Blue
  '#ECCC68'  // Golden Yellow
];

// Available Roguelite Upgrades
const UPGRADE_POOL = [
  { id: 'damage', title: 'Fuerza Destructiva', desc: '+30% Daño de Ataque', icon: '⚔️' },
  { id: 'fireRate', title: 'Disparo Rápido', desc: '+25% Velocidad de Disparo', icon: '⚡' },
  { id: 'maxHp', title: 'Fortaleza Blindada', desc: '+60 Max HP y +100 Reparación', icon: '🛡️' },
  { id: 'attackRange', title: 'Alcance Extendido', desc: '+35% Rango de Ataque (PVE/PVP)', icon: '🎯' },
  { id: 'visionRange', title: 'Torre de Radar', desc: '+40% Rango de Visión', icon: '👁️' }
];

// Game State Containers
let players = {};
let zombies = {};
let projectiles = [];
let hitEffects = [];
let zombieIdCounter = 1;
let projectileIdCounter = 1;

let wave = 1;
let waveTimer = 0;
const WAVE_INTERVAL = 20000; // 20 seconds per wave
let lastTickTime = Date.now();

// Helper functions
function getRandomSpawnPosition(playerCount) {
  const angle = (playerCount * (Math.PI * 2 / 8)) + (Math.random() * 0.4 - 0.2);
  const radius = 600 + Math.random() * 100;
  const x = Math.max(100, Math.min(MAP_SIZE - 100, MAP_SIZE / 2 + Math.cos(angle) * radius));
  const y = Math.max(100, Math.min(MAP_SIZE - 100, MAP_SIZE / 2 + Math.sin(angle) * radius));
  return { x: Math.round(x), y: Math.round(y) };
}

function getRandomPerks() {
  const shuffled = [...UPGRADE_POOL].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

function spawnZombiesForPlayer(player) {
  if (!player.alive) return;
  
  // Balanced zombie count per wave
  const count = wave === 1 ? 3 : (wave === 2 ? 4 : Math.min(15, Math.floor(3 + wave * 1.5)));
  
  for (let i = 0; i < count; i++) {
    // Distribute angles evenly around tower with slight randomness
    const angle = ((i * (Math.PI * 2 / count)) + (Math.random() * 0.4 - 0.2));
    const distance = player.visionRange + 180 + Math.random() * 150;
    const spawnX = Math.max(50, Math.min(MAP_SIZE - 50, player.x + Math.cos(angle) * distance));
    const spawnY = Math.max(50, Math.min(MAP_SIZE - 50, player.y + Math.sin(angle) * distance));
    
    // Zombie variants based on wave & random roll
    const typeRoll = Math.random();
    let type = 'normal';
    let hp = 25 + wave * 12; // Wave 1 HP = 37 (Player damage = 40 => 1-shot kill!)
    let speed = 45 + Math.random() * 8; // Slower speed so player can shoot them down easily
    let damage = 6;
    let rewardXp = 25;
    let rewardCoins = 10;
    let radius = 14;
    let color = '#7BED9F';

    // Fast and Tank zombies only spawn on wave >= 2 or higher
    if (wave >= 2 && typeRoll > 0.70 && typeRoll <= 0.90) {
      type = 'fast';
      hp = 20 + wave * 8;
      speed = 85 + Math.random() * 10;
      damage = 4;
      rewardXp = 20;
      rewardCoins = 8;
      radius = 11;
      color = '#ECCC68';
    } else if (wave >= 2 && typeRoll > 0.90) {
      type = 'tank';
      hp = 70 + wave * 25;
      speed = 35 + Math.random() * 5;
      damage = 15;
      rewardXp = 50;
      rewardCoins = 20;
      radius = 18;
      color = '#FF6B81';
    }

    const zId = `z_${zombieIdCounter++}`;
    zombies[zId] = {
      id: zId,
      type,
      x: spawnX,
      y: spawnY,
      hp,
      maxHp: hp,
      speed,
      damage,
      rewardXp,
      rewardCoins,
      radius,
      color,
      targetPlayerId: player.id,
      lastAttackTime: 0
    };
  }
}

// Socket Connection Handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const activePlayerCount = Object.keys(players).length;
  const spawn = getRandomSpawnPosition(activePlayerCount);
  const color = COLOR_PALETTE[activePlayerCount % COLOR_PALETTE.length];

  // Initialize new player tower state (Buffed starting stats for smoother early game)
  players[socket.id] = {
    id: socket.id,
    name: `Torre ${socket.id.substring(0, 4)}`,
    x: spawn.x,
    y: spawn.y,
    color: color,
    hp: 300,
    maxHp: 300,
    level: 1,
    xp: 0,
    xpToNextLevel: 50, // Requires only 2 zombie kills for the 1st Roguelite level up!
    coins: 0,
    kills: 0,
    damage: 40,
    fireRate: 1.8, // Fast initial shooting (1 shot every ~550ms)
    attackRange: 320,
    visionRange: 480,
    alive: true,
    lastShotTime: 0,
    upgradePending: false,
    upgradesCount: 0
  };

  // Notify new player of init data
  socket.emit('init_game', {
    playerId: socket.id,
    mapSize: MAP_SIZE,
    player: players[socket.id]
  });

  // Spawn initial wave after a 3-second grace period
  setTimeout(() => {
    if (players[socket.id]) {
      spawnZombiesForPlayer(players[socket.id]);
    }
  }, 3000);

  // Handle Roguelite Upgrade selection
  socket.on('choose_upgrade', (perkId) => {
    const player = players[socket.id];
    if (!player || !player.alive || !player.upgradePending) return;

    switch (perkId) {
      case 'damage':
        player.damage = Math.round(player.damage * 1.3);
        break;
      case 'fireRate':
        player.fireRate = parseFloat((player.fireRate * 1.25).toFixed(2));
        break;
      case 'maxHp':
        player.maxHp += 60;
        player.hp = Math.min(player.maxHp, player.hp + 100);
        break;
      case 'attackRange':
        player.attackRange = Math.round(player.attackRange * 1.35);
        break;
      case 'visionRange':
        player.visionRange = Math.round(player.visionRange * 1.4);
        break;
    }

    player.upgradesCount++;
    player.upgradePending = false;

    // Check if player accumulated enough XP for another level immediately
    checkLevelUp(player, socket);
    socket.emit('upgrade_applied', { player });
  });

  // Respawn / Rejoin request
  socket.on('request_respawn', () => {
    const activeCount = Object.keys(players).length;
    const newSpawn = getRandomSpawnPosition(activeCount);
    players[socket.id] = {
      id: socket.id,
      name: `Torre ${socket.id.substring(0, 4)}`,
      x: newSpawn.x,
      y: newSpawn.y,
      color: players[socket.id] ? players[socket.id].color : COLOR_PALETTE[activeCount % COLOR_PALETTE.length],
      hp: 200,
      maxHp: 200,
      level: 1,
      xp: 0,
      xpToNextLevel: 100,
      coins: 0,
      kills: 0,
      damage: 30,
      fireRate: 1.2,
      attackRange: 260,
      visionRange: 450,
      alive: true,
      lastShotTime: 0,
      upgradePending: false,
      upgradesCount: 0
    };
    socket.emit('init_game', {
      playerId: socket.id,
      mapSize: MAP_SIZE,
      player: players[socket.id]
    });
    spawnZombiesForPlayer(players[socket.id]);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
  });
});

function checkLevelUp(player, socket) {
  if (player.xp >= player.xpToNextLevel && !player.upgradePending) {
    player.level++;
    player.xp -= player.xpToNextLevel;
    player.xpToNextLevel = Math.round(player.xpToNextLevel * 1.45);
    player.upgradePending = true;

    const perkChoices = getRandomPerks();
    socket.emit('level_up_options', {
      level: player.level,
      options: perkChoices
    });
  }
}

function grantReward(player, xpAmount, coinAmount) {
  if (!player || !player.alive) return;
  player.xp += xpAmount;
  player.coins += coinAmount;

  const socket = io.sockets.sockets.get(player.id);
  if (socket) {
    checkLevelUp(player, socket);
  }
}

// SERVER GAME TICK LOOP (~30 FPS / 33ms)
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTickTime) / 1000;
  lastTickTime = now;

  // 1. WAVE TIMER & ZOMBIE SPONING
  waveTimer += dt * 1000;
  if (waveTimer >= WAVE_INTERVAL) {
    waveTimer = 0;
    wave++;
    io.emit('wave_start', { wave });
    Object.values(players).forEach(p => {
      if (p.alive) spawnZombiesForPlayer(p);
    });
  }

  // Passive Tower HP Regeneration (+3 HP/sec)
  Object.values(players).forEach(p => {
    if (p.alive && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, Math.round(p.hp + 3 * dt));
    }
  });

  // 2. ZOMBIE AI & MOVEMENT
  const alivePlayerIds = Object.keys(players).filter(id => players[id].alive);
  
  Object.values(zombies).forEach(zombie => {
    // Find closest alive player tower if current target is dead or missing
    let targetPlayer = players[zombie.targetPlayerId];
    if (!targetPlayer || !targetPlayer.alive) {
      let minDist = Infinity;
      let closestId = null;
      alivePlayerIds.forEach(pId => {
        const p = players[pId];
        const dist = Math.hypot(p.x - zombie.x, p.y - zombie.y);
        if (dist < minDist) {
          minDist = dist;
          closestId = pId;
        }
      });
      if (closestId) {
        zombie.targetPlayerId = closestId;
        targetPlayer = players[closestId];
      }
    }

    if (targetPlayer && targetPlayer.alive) {
      const dx = targetPlayer.x - zombie.x;
      const dy = targetPlayer.y - zombie.y;
      const dist = Math.hypot(dx, dy);

      const hitDist = TOWER_RADIUS + zombie.radius;
      if (dist <= hitDist) {
        // Zombie attacks tower directly
        if (now - zombie.lastAttackTime >= 1000) {
          zombie.lastAttackTime = now;
          targetPlayer.hp = Math.max(0, targetPlayer.hp - zombie.damage);

          hitEffects.push({
            x: targetPlayer.x + (Math.random() * 20 - 10),
            y: targetPlayer.y + (Math.random() * 20 - 10),
            color: '#FF4757'
          });

          if (targetPlayer.hp <= 0) {
            targetPlayer.alive = false;
            io.to(targetPlayer.id).emit('player_died', { killer: 'Zombis' });
            checkWinner();
          }
        }
      } else {
        // Move zombie towards target tower
        const moveDist = zombie.speed * dt;
        zombie.x += (dx / dist) * moveDist;
        zombie.y += (dy / dist) * moveDist;
      }
    }
  });

  // 3. TOWER TARGETING & SHOOTING (PVE & PVP)
  Object.values(players).forEach(player => {
    if (!player.alive) return;

    const fireInterval = 1000 / player.fireRate;
    if (now - player.lastShotTime >= fireInterval) {
      // Find candidate targets inside player.attackRange
      let bestTarget = null;
      let targetType = null;
      let minDist = player.attackRange;

      // Priority 1: Zombies in range
      Object.values(zombies).forEach(zombie => {
        const dist = Math.hypot(zombie.x - player.x, zombie.y - player.y);
        if (dist <= minDist) {
          minDist = dist;
          bestTarget = zombie;
          targetType = 'zombie';
        }
      });

      // Priority 2: If NO zombie in range, target enemy player towers inside attackRange (PVP!)
      if (!bestTarget) {
        Object.values(players).forEach(enemy => {
          if (enemy.id !== player.id && enemy.alive) {
            const dist = Math.hypot(enemy.x - player.x, enemy.y - player.y);
            if (dist <= minDist) {
              minDist = dist;
              bestTarget = enemy;
              targetType = 'player';
            }
          }
        });
      }

      // Shoot projectile if target found
      if (bestTarget) {
        player.lastShotTime = now;
        const pId = `p_${projectileIdCounter++}`;
        projectiles.push({
          id: pId,
          ownerId: player.id,
          targetType: targetType,
          targetId: bestTarget.id,
          x: player.x,
          y: player.y,
          targetX: bestTarget.x,
          targetY: bestTarget.y,
          speed: 550,
          damage: player.damage,
          color: player.color
        });
      }
    }
  });

  // 4. PROJECTILE MOVEMENT & HIT DETECT
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    
    // Acquire current target position
    let targetObj = null;
    if (proj.targetType === 'zombie') {
      targetObj = zombies[proj.targetId];
    } else if (proj.targetType === 'player') {
      targetObj = players[proj.targetId];
    }

    // Update target coordinates if target still exists
    if (targetObj && (targetObj.alive === undefined || targetObj.alive)) {
      proj.targetX = targetObj.x;
      proj.targetY = targetObj.y;
    }

    const dx = proj.targetX - proj.x;
    const dy = proj.targetY - proj.y;
    const dist = Math.hypot(dx, dy);
    const step = proj.speed * dt;

    if (dist <= step || dist < 15) {
      // Hit impact!
      if (proj.targetType === 'zombie' && targetObj) {
        targetObj.hp -= proj.damage;
        hitEffects.push({ x: proj.targetX, y: proj.targetY, color: '#FFFFFF' });

        if (targetObj.hp <= 0) {
          const shooter = players[proj.ownerId];
          if (shooter) {
            shooter.kills++;
            grantReward(shooter, targetObj.rewardXp, targetObj.rewardCoins);
          }
          delete zombies[proj.targetId];
        }
      } else if (proj.targetType === 'player' && targetObj && targetObj.alive) {
        targetObj.hp = Math.max(0, targetObj.hp - proj.damage);
        hitEffects.push({ x: proj.targetX, y: proj.targetY, color: proj.color });

        if (targetObj.hp <= 0) {
          targetObj.alive = false;
          io.to(targetObj.id).emit('player_died', { killer: players[proj.ownerId] ? players[proj.ownerId].name : 'Jugador Enemigo' });
          checkWinner();
        }
      }

      projectiles.splice(i, 1);
    } else {
      // Advance projectile forward
      proj.x += (dx / dist) * step;
      proj.y += (dy / dist) * step;
    }
  }

  // Clear old hit effects
  const activeEffects = hitEffects.splice(0, hitEffects.length);

  // Broadcast state snapshot to all connected clients
  io.emit('state_update', {
    players,
    zombies,
    projectiles,
    hitEffects: activeEffects,
    wave,
    waveTimeRemaining: Math.max(0, Math.ceil((WAVE_INTERVAL - waveTimer) / 1000))
  });

}, 33);

function checkWinner() {
  const activePlayers = Object.values(players);
  const alivePlayers = activePlayers.filter(p => p.alive);
  
  if (activePlayers.length > 1 && alivePlayers.length === 1) {
    const winner = alivePlayers[0];
    io.emit('game_over', { winner: winner.name, color: winner.color });
  }
}

server.listen(PORT, () => {
  console.log(`🚀 Servidor de Tower Defense corriendo en http://localhost:${PORT}`);
});
