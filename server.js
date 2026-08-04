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
  { id: 'damage', title: 'Fuerza Destructiva', desc: '+35% Daño de Ataque', icon: '⚔️' },
  { id: 'fireRate', title: 'Disparo Rápido', desc: '+30% Velocidad de Disparo', icon: '⚡' },
  { id: 'maxHp', title: 'Fortaleza Blindada', desc: '+80 Max HP y +120 Reparación', icon: '🛡️' },
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

let lastTickTime = Date.now();

function getRandomPerks() {
  const shuffled = [...UPGRADE_POOL].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 3);
}

function clearZombiesForPlayer(playerId) {
  Object.keys(zombies).forEach(zId => {
    if (zombies[zId].targetPlayerId === playerId) {
      delete zombies[zId];
    }
  });
}

function spawnZombiesForPlayer(player) {
  if (!player.alive) return;

  const currentWave = player.wave;
  // Controlled zombies count per wave
  const count = currentWave === 1 ? 3 : (currentWave === 2 ? 4 : Math.min(14, Math.floor(3 + currentWave * 1.4)));
  
  for (let i = 0; i < count; i++) {
    const angle = ((i * (Math.PI * 2 / count)) + (Math.random() * 0.3 - 0.15));
    const distance = player.visionRange + 180 + Math.random() * 120;
    const spawnX = Math.max(80, Math.min(MAP_SIZE - 80, player.x + Math.cos(angle) * distance));
    const spawnY = Math.max(80, Math.min(MAP_SIZE - 80, player.y + Math.sin(angle) * distance));
    
    const typeRoll = Math.random();
    let type = 'normal';
    let hp = 20 + currentWave * 10; // Wave 1 HP = 30 (Player damage = 45 => 1-shot kill!)
    let speed = 40 + Math.random() * 8; // Slower speed for clear player control
    let damage = 5;
    let rewardXp = 25;
    let rewardCoins = 10;
    let radius = 14;
    let color = '#7BED9F';

    if (currentWave >= 2 && typeRoll > 0.70 && typeRoll <= 0.90) {
      type = 'fast';
      hp = 18 + currentWave * 8;
      speed = 75 + Math.random() * 10;
      damage = 4;
      rewardXp = 20;
      rewardCoins = 8;
      radius = 11;
      color = '#ECCC68';
    } else if (currentWave >= 2 && typeRoll > 0.90) {
      type = 'tank';
      hp = 60 + currentWave * 20;
      speed = 30 + Math.random() * 5;
      damage = 12;
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

  player.waveActive = true;
}

// Socket Connection Handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Send map initial info
  socket.emit('connected', { mapSize: MAP_SIZE, existingPlayers: players });

  // Player places tower and joins
  socket.on('join_game', (data) => {
    const activePlayerCount = Object.keys(players).length;
    const color = COLOR_PALETTE[activePlayerCount % COLOR_PALETTE.length];

    // Validate spawn coordinates
    const posX = Math.max(100, Math.min(MAP_SIZE - 100, data.x || 1000));
    const posY = Math.max(100, Math.min(MAP_SIZE - 100, data.y || 1000));
    const playerName = (data.name && data.name.trim().length > 0) ? data.name.trim().substring(0, 12) : `Torre ${socket.id.substring(0, 4)}`;

    players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: posX,
      y: posY,
      color: color,
      hp: 350,
      maxHp: 350,
      level: 1,
      xp: 0,
      xpToNextLevel: 50,
      coins: 0,
      kills: 0,
      damage: 45,
      fireRate: 2.0, // 2 shots per second
      attackRange: 330,
      visionRange: 500,
      alive: true,
      lastShotTime: 0,
      upgradePending: false,
      upgradesCount: 0,
      wave: 1,
      waveActive: false
    };

    socket.emit('init_game', {
      playerId: socket.id,
      mapSize: MAP_SIZE,
      player: players[socket.id]
    });
  });

  // Manual Wave Trigger by player
  socket.on('start_next_wave', () => {
    const player = players[socket.id];
    if (!player || !player.alive) return;

    // Check if player has no active zombies left
    const playerZombies = Object.values(zombies).filter(z => z.targetPlayerId === player.id);
    if (playerZombies.length === 0) {
      if (player.waveActive) {
        player.wave++;
      }
      spawnZombiesForPlayer(player);
      socket.emit('wave_started', { wave: player.wave });
    }
  });

  // Handle Roguelite Upgrade selection
  socket.on('choose_upgrade', (perkId) => {
    const player = players[socket.id];
    if (!player || !player.alive || !player.upgradePending) return;

    switch (perkId) {
      case 'damage':
        player.damage = Math.round(player.damage * 1.35);
        break;
      case 'fireRate':
        player.fireRate = parseFloat((player.fireRate * 1.30).toFixed(2));
        break;
      case 'maxHp':
        player.maxHp += 80;
        player.hp = Math.min(player.maxHp, player.hp + 120);
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

    checkLevelUp(player, socket);
    socket.emit('upgrade_applied', { player });
  });

  // Respawn request -> Clears zombies and puts back into placement mode
  socket.on('request_respawn', () => {
    clearZombiesForPlayer(socket.id);
    delete players[socket.id];
    socket.emit('reset_to_start');
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    clearZombiesForPlayer(socket.id);
    delete players[socket.id];
  });
});

function checkLevelUp(player, socket) {
  if (player.xp >= player.xpToNextLevel && !player.upgradePending) {
    player.level++;
    player.xp -= player.xpToNextLevel;
    player.xpToNextLevel = Math.round(player.xpToNextLevel * 1.4);
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

  // Passive Tower HP Regeneration (+4 HP/sec)
  Object.values(players).forEach(p => {
    if (p.alive && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, Math.round(p.hp + 4 * dt));
    }
  });

  // ZOMBIE AI & MOVEMENT
  const alivePlayerIds = Object.keys(players).filter(id => players[id].alive);
  
  Object.values(zombies).forEach(zombie => {
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
            clearZombiesForPlayer(targetPlayer.id); // CLEAR ZOMBIES ON DEATH!
            io.to(targetPlayer.id).emit('player_died', { killer: 'Zombis' });
            checkWinner();
          }
        }
      } else {
        const moveDist = zombie.speed * dt;
        zombie.x += (dx / dist) * moveDist;
        zombie.y += (dy / dist) * moveDist;
      }
    }
  });

  // TOWER TARGETING & SHOOTING (PVE & PVP)
  Object.values(players).forEach(player => {
    if (!player.alive) return;

    const fireInterval = 1000 / player.fireRate;
    if (now - player.lastShotTime >= fireInterval) {
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

      // Priority 2: Enemy player towers inside attackRange (PVP)
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
          speed: 600,
          damage: player.damage,
          color: player.color
        });
      }
    }
  });

  // PROJECTILE MOVEMENT & HIT DETECT
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    
    let targetObj = null;
    if (proj.targetType === 'zombie') {
      targetObj = zombies[proj.targetId];
    } else if (proj.targetType === 'player') {
      targetObj = players[proj.targetId];
    }

    if (targetObj && (targetObj.alive === undefined || targetObj.alive)) {
      proj.targetX = targetObj.x;
      proj.targetY = targetObj.y;
    }

    const dx = proj.targetX - proj.x;
    const dy = proj.targetY - proj.y;
    const dist = Math.hypot(dx, dy);
    const step = proj.speed * dt;

    if (dist <= step || dist < 15) {
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
          clearZombiesForPlayer(targetObj.id); // CLEAR ZOMBIES ON DEATH!
          io.to(targetObj.id).emit('player_died', { killer: players[proj.ownerId] ? players[proj.ownerId].name : 'Jugador Enemigo' });
          checkWinner();
        }
      }

      projectiles.splice(i, 1);
    } else {
      proj.x += (dx / dist) * step;
      proj.y += (dy / dist) * step;
    }
  }

  const activeEffects = hitEffects.splice(0, hitEffects.length);

  // Broadcast state snapshot
  io.emit('state_update', {
    players,
    zombies,
    projectiles,
    hitEffects: activeEffects
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
