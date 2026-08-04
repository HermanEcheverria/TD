const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000;
const TOWER_RADIUS = 36;
const COLOR_PALETTE = [
  '#FF4757', '#2ED573', '#1E90FF', '#FFA502',
  '#9B59B6', '#FF6B81', '#70A1FF', '#ECCC68'
];

// Roguelite Perks
const UPGRADE_POOL = [
  { id: 'damage', title: 'Fuerza Destructiva', desc: '+35% Daño de Ataque', icon: '⚔️' },
  { id: 'fireRate', title: 'Disparo Rápido', desc: '+30% Velocidad de Disparo', icon: '⚡' },
  { id: 'maxHp', title: 'Fortaleza Blindada', desc: '+80 Max HP y +120 Reparación', icon: '🛡️' },
  { id: 'attackRange', title: 'Alcance Extendido', desc: '+35% Rango de Ataque (PVE/PVP)', icon: '🎯' },
  { id: 'visionRange', title: 'Torre de Radar', desc: '+40% Rango de Visión', icon: '👁️' }
];

// Coin Shop Items Definitions
const SHOP_ITEMS = {
  double_barrel: { name: 'Cañón Múltiple', desc: '+1 Proyectil por disparo', baseCost: 120, icon: '🚀' },
  explosive_rounds: { name: 'Balas Explosivas', desc: 'Daño en área (Splash) al impactar', baseCost: 150, icon: '💥' },
  shield_barrier: { name: 'Escudo de Fuerza', desc: '+150 HP de Escudo Protector', baseCost: 80, icon: '🛡️' },
  gold_mine: { name: 'Generador de Oro', desc: '+6 Monedas y +10 XP cada segundo', baseCost: 90, icon: '💰' },
  turbo_charger: { name: 'Supercargador Turbo', desc: '+35% Velocidad de Disparo', baseCost: 110, icon: '⚡' },
  sniper_scope: { name: 'Mira Sniper', desc: '+140 Alcance de Ataque y +50 Daño', baseCost: 180, icon: '🔭' }
};

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
  const count = currentWave === 1 ? 3 : (currentWave === 2 ? 4 : Math.min(15, Math.floor(3 + currentWave * 1.4)));
  
  for (let i = 0; i < count; i++) {
    const angle = ((i * (Math.PI * 2 / count)) + (Math.random() * 0.3 - 0.15));
    const distance = player.visionRange + 180 + Math.random() * 120;
    const spawnX = Math.max(80, Math.min(MAP_SIZE - 80, player.x + Math.cos(angle) * distance));
    const spawnY = Math.max(80, Math.min(MAP_SIZE - 80, player.y + Math.sin(angle) * distance));
    
    const typeRoll = Math.random();
    let type = 'normal';
    let hp = 20 + currentWave * 10;
    let speed = 40 + Math.random() * 8;
    let damage = 5;
    let rewardXp = 25;
    let rewardCoins = 12;
    let radius = 14;
    let color = '#7BED9F';

    if (currentWave >= 4 && typeRoll > 0.92) {
      type = 'boss';
      hp = 180 + currentWave * 45;
      speed = 28 + Math.random() * 4;
      damage = 25;
      rewardXp = 120;
      rewardCoins = 60;
      radius = 26;
      color = '#A855F7';
    } else if (currentWave >= 2 && typeRoll > 0.70 && typeRoll <= 0.90) {
      type = 'fast';
      hp = 18 + currentWave * 8;
      speed = 75 + Math.random() * 10;
      damage = 4;
      rewardXp = 20;
      rewardCoins = 10;
      radius = 11;
      color = '#ECCC68';
    } else if (currentWave >= 2 && typeRoll > 0.90) {
      type = 'tank';
      hp = 60 + currentWave * 20;
      speed = 30 + Math.random() * 5;
      damage = 12;
      rewardXp = 50;
      rewardCoins = 25;
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

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.emit('connected', { mapSize: MAP_SIZE, shopItems: SHOP_ITEMS });

  socket.on('join_game', (data) => {
    const activePlayerCount = Object.keys(players).length;
    const color = COLOR_PALETTE[activePlayerCount % COLOR_PALETTE.length];

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
      shieldHp: 0,
      maxShieldHp: 0,
      level: 1,
      xp: 0,
      xpToNextLevel: 50,
      coins: 50, // Starting bonus coins!
      kills: 0,
      damage: 45,
      fireRate: 2.0,
      attackRange: 330,
      visionRange: 500,
      multiShot: 1,
      splashRadius: 0,
      goldMineLevel: 0,
      alive: true,
      lastShotTime: 0,
      upgradePending: false,
      upgradesCount: 0,
      wave: 1,
      waveActive: false,
      shopPurchases: {
        double_barrel: 0,
        explosive_rounds: 0,
        shield_barrier: 0,
        gold_mine: 0,
        turbo_charger: 0,
        sniper_scope: 0
      }
    };

    socket.emit('init_game', {
      playerId: socket.id,
      mapSize: MAP_SIZE,
      player: players[socket.id],
      shopItems: SHOP_ITEMS
    });
  });

  socket.on('start_next_wave', () => {
    const player = players[socket.id];
    if (!player || !player.alive) return;

    const playerZombies = Object.values(zombies).filter(z => z.targetPlayerId === player.id);
    if (playerZombies.length === 0) {
      if (player.waveActive) {
        player.wave++;
      }
      spawnZombiesForPlayer(player);
      socket.emit('wave_started', { wave: player.wave });
    }
  });

  // Handle Coin Shop Purchases
  socket.on('buy_shop_item', (itemId) => {
    const player = players[socket.id];
    if (!player || !player.alive || !SHOP_ITEMS[itemId]) return;

    const currentCount = player.shopPurchases[itemId] || 0;
    const cost = Math.round(SHOP_ITEMS[itemId].baseCost * Math.pow(1.35, currentCount));

    if (player.coins >= cost) {
      player.coins -= cost;
      player.shopPurchases[itemId] = currentCount + 1;

      switch (itemId) {
        case 'double_barrel':
          player.multiShot += 1;
          break;
        case 'explosive_rounds':
          player.splashRadius = (player.splashRadius === 0) ? 65 : player.splashRadius + 25;
          break;
        case 'shield_barrier':
          player.maxShieldHp += 150;
          player.shieldHp += 150;
          break;
        case 'gold_mine':
          player.goldMineLevel += 1;
          break;
        case 'turbo_charger':
          player.fireRate = parseFloat((player.fireRate * 1.35).toFixed(2));
          break;
        case 'sniper_scope':
          player.attackRange += 140;
          player.damage += 50;
          break;
      }

      socket.emit('shop_purchase_success', { player, itemId, cost });
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

let lastGoldMineTick = Date.now();

// SERVER GAME TICK LOOP (~30 FPS / 33ms)
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTickTime) / 1000;
  lastTickTime = now;

  // Passive HP Regen (+4 HP/sec) & Gold Mine income
  const isGoldMineSecond = (now - lastGoldMineTick >= 1000);
  if (isGoldMineSecond) {
    lastGoldMineTick = now;
  }

  Object.values(players).forEach(p => {
    if (p.alive) {
      if (p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, Math.round(p.hp + 4 * dt));
      }
      // Gold Mine bonus
      if (isGoldMineSecond && p.goldMineLevel > 0) {
        grantReward(p, p.goldMineLevel * 10, p.goldMineLevel * 6);
      }
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

          // Shield takes damage first!
          if (targetPlayer.shieldHp > 0) {
            targetPlayer.shieldHp -= zombie.damage;
            if (targetPlayer.shieldHp < 0) {
              targetPlayer.hp = Math.max(0, targetPlayer.hp + targetPlayer.shieldHp);
              targetPlayer.shieldHp = 0;
            }
          } else {
            targetPlayer.hp = Math.max(0, targetPlayer.hp - zombie.damage);
          }

          hitEffects.push({
            x: targetPlayer.x + (Math.random() * 20 - 10),
            y: targetPlayer.y + (Math.random() * 20 - 10),
            color: '#FF4757'
          });

          if (targetPlayer.hp <= 0) {
            targetPlayer.alive = false;
            clearZombiesForPlayer(targetPlayer.id);
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

  // TOWER TARGETING & MULTI-SHOT FIRING
  Object.values(players).forEach(player => {
    if (!player.alive) return;

    const fireInterval = 1000 / player.fireRate;
    if (now - player.lastShotTime >= fireInterval) {
      let targets = [];

      // Find targets inside attackRange
      const candidateZombies = Object.values(zombies).filter(z => Math.hypot(z.x - player.x, z.y - player.y) <= player.attackRange);
      candidateZombies.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));

      if (candidateZombies.length > 0) {
        targets = candidateZombies.slice(0, player.multiShot).map(z => ({ type: 'zombie', obj: z }));
      } else {
        // Target enemy towers if no zombies in range
        const candidateEnemies = Object.values(players).filter(p => p.id !== player.id && p.alive && Math.hypot(p.x - player.x, p.y - player.y) <= player.attackRange);
        candidateEnemies.sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y));
        if (candidateEnemies.length > 0) {
          targets = candidateEnemies.slice(0, player.multiShot).map(e => ({ type: 'player', obj: e }));
        }
      }

      if (targets.length > 0) {
        player.lastShotTime = now;

        targets.forEach(t => {
          const pId = `p_${projectileIdCounter++}`;
          projectiles.push({
            id: pId,
            ownerId: player.id,
            targetType: t.type,
            targetId: t.obj.id,
            x: player.x,
            y: player.y,
            targetX: t.obj.x,
            targetY: t.obj.y,
            speed: 600,
            damage: player.damage,
            splashRadius: player.splashRadius,
            color: player.color
          });
        });
      }
    }
  });

  // PROJECTILE MOVEMENT & HIT DETECT (SPLASH SUPPORT)
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
      const shooter = players[proj.ownerId];

      if (proj.targetType === 'zombie' && targetObj) {
        // Direct damage or Splash damage
        if (proj.splashRadius > 0) {
          hitEffects.push({ x: proj.targetX, y: proj.targetY, color: '#f97316', radius: proj.splashRadius });
          
          Object.values(zombies).forEach(z => {
            const dToSplash = Math.hypot(z.x - proj.targetX, z.y - proj.targetY);
            if (dToSplash <= proj.splashRadius) {
              z.hp -= proj.damage;
              if (z.hp <= 0 && zombies[z.id]) {
                if (shooter) {
                  shooter.kills++;
                  grantReward(shooter, z.rewardXp, z.rewardCoins);
                }
                delete zombies[z.id];
              }
            }
          });
        } else {
          targetObj.hp -= proj.damage;
          hitEffects.push({ x: proj.targetX, y: proj.targetY, color: '#FFFFFF' });

          if (targetObj.hp <= 0) {
            if (shooter) {
              shooter.kills++;
              grantReward(shooter, targetObj.rewardXp, targetObj.rewardCoins);
            }
            delete zombies[proj.targetId];
          }
        }
      } else if (proj.targetType === 'player' && targetObj && targetObj.alive) {
        if (targetObj.shieldHp > 0) {
          targetObj.shieldHp -= proj.damage;
          if (targetObj.shieldHp < 0) {
            targetObj.hp = Math.max(0, targetObj.hp + targetObj.shieldHp);
            targetObj.shieldHp = 0;
          }
        } else {
          targetObj.hp = Math.max(0, targetObj.hp - proj.damage);
        }

        hitEffects.push({ x: proj.targetX, y: proj.targetY, color: proj.color });

        if (targetObj.hp <= 0) {
          targetObj.alive = false;
          clearZombiesForPlayer(targetObj.id);
          io.to(targetObj.id).emit('player_died', { killer: shooter ? shooter.name : 'Jugador Enemigo' });
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

const os = require('os');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalIpAddress();
  console.log(`\n======================================================`);
  console.log(`🚀 SERVIDOR MULTIJUGADOR LAN ACTIVO`);
  console.log(`📌 En tu PC: http://localhost:${PORT}`);
  console.log(`🌐 En la misma red Wi-Fi: http://${localIp}:${PORT}`);
  console.log(`======================================================\n`);
});
