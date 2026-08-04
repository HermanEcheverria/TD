// Client-side Phaser 3 + Socket.io Game Controller

class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });
  }

  preload() {
    // No external image assets needed - using Phaser procedural Graphics
  }

  create() {
    this.socket = io();
    this.localPlayerId = null;
    this.mapSize = 2000;

    // Render containers for depth management
    this.bgGraphics = this.add.graphics();
    this.rangeGraphics = this.add.graphics();
    this.towersContainer = this.add.container(0, 0);
    this.zombiesContainer = this.add.container(0, 0);
    this.projectilesGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();

    // Map bounds
    this.cameras.main.setBounds(0, 0, this.mapSize, this.mapSize);

    // Audio Synthesizer (Web Audio API)
    this.initAudio();

    // Setup Socket Listeners
    this.setupSocket();

    // Resize listener
    window.addEventListener('resize', () => {
      this.scale.resize(window.innerWidth, window.innerHeight);
    });
  }

  initAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
    } catch (e) {
      console.warn('Web Audio API not supported');
    }
  }

  playSynthSound(type) {
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'shoot') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'levelup') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else if (type === 'explosion') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(20, now + 0.35);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  }

  setupSocket() {
    this.socket.on('init_game', (data) => {
      this.localPlayerId = data.playerId;
      this.mapSize = data.mapSize;
      this.drawMapGrid();

      // Camera smooth track initial position
      if (data.player) {
        this.cameras.main.centerOn(data.player.x, data.player.y);
      }
    });

    this.socket.on('state_update', (data) => {
      this.renderGameState(data);
    });

    this.socket.on('level_up_options', (data) => {
      this.playSynthSound('levelup');
      this.showUpgradeModal(data.options);
    });

    this.socket.on('upgrade_applied', (data) => {
      document.getElementById('upgrade-modal').style.display = 'none';
    });

    this.socket.on('player_died', (data) => {
      this.playSynthSound('explosion');
      this.showGameOverModal(false, data.killer);
    });

    this.socket.on('game_over', (data) => {
      if (data.winner === (this.lastStatePlayers[this.localPlayerId] ? this.lastStatePlayers[this.localPlayerId].name : '')) {
        this.showGameOverModal(true, '¡Eres el último sobreviviente!');
      }
    });
  }

  drawMapGrid() {
    const g = this.bgGraphics;
    g.clear();

    // Dark Map Background
    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, 0, this.mapSize, this.mapSize);

    // Grid lines
    g.lineStyle(1, 0x1e293b, 0.6);
    const gridSize = 100;
    for (let x = 0; x <= this.mapSize; x += gridSize) {
      g.lineBetween(x, 0, x, this.mapSize);
    }
    for (let y = 0; y <= this.mapSize; y += gridSize) {
      g.lineBetween(0, y, this.mapSize, y);
    }

    // Outer Boundary Glow
    g.lineStyle(6, 0xef4444, 0.8);
    g.strokeRect(0, 0, this.mapSize, this.mapSize);
  }

  renderGameState(state) {
    this.lastStatePlayers = state.players;
    const localPlayer = state.players[this.localPlayerId];

    // Smooth Camera Following Local Player Tower
    if (localPlayer && localPlayer.alive) {
      this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, localPlayer.x - this.cameras.main.width / 2, 0.1);
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, localPlayer.y - this.cameras.main.height / 2, 0.1);

      // Update Local Player HUD
      document.getElementById('hp-text').innerText = `${localPlayer.hp} / ${localPlayer.maxHp}`;
      const hpPct = Math.max(0, (localPlayer.hp / localPlayer.maxHp) * 100);
      document.getElementById('hp-fill').style.width = `${hpPct}%`;

      document.getElementById('level-badge').innerText = `NIVEL ${localPlayer.level}`;
      document.getElementById('xp-text').innerText = `${localPlayer.xp} / ${localPlayer.xpToNextLevel} XP`;
      const xpPct = Math.min(100, (localPlayer.xp / localPlayer.xpToNextLevel) * 100);
      document.getElementById('xp-fill').style.width = `${xpPct}%`;

      document.getElementById('coins-text').innerText = localPlayer.coins;
      document.getElementById('kills-text').innerText = localPlayer.kills;
      document.getElementById('wave-text').innerText = state.wave;
      document.getElementById('wave-timer-text').innerText = state.waveTimeRemaining;
    }

    // Update Leaderboard
    this.updateLeaderboard(state.players);

    // Clear graphics for frame
    this.rangeGraphics.clear();
    this.projectilesGraphics.clear();
    this.fxGraphics.clear();
    this.towersContainer.removeAll(true);
    this.zombiesContainer.removeAll(true);

    // 1. RENDER RANGES FOR LOCAL PLAYER
    if (localPlayer && localPlayer.alive) {
      const colorNum = parseInt(localPlayer.color.replace('#', '0x'), 16);

      // Vision Range Circle (Subtle Fog Reveal Area)
      this.rangeGraphics.lineStyle(2, 0xffffff, 0.15);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.visionRange);

      // Attack Range Circle (Dynamic indicator)
      this.rangeGraphics.lineStyle(2, colorNum, 0.4);
      this.rangeGraphics.fillStyle(colorNum, 0.05);
      this.rangeGraphics.fillCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange);
    }

    // 2. RENDER PLAYERS & TOWERS
    Object.values(state.players).forEach(player => {
      if (!player.alive) return;

      const pColor = parseInt(player.color.replace('#', '0x'), 16);
      const isLocal = player.id === this.localPlayerId;

      // Base Tower Container
      const tContainer = this.add.container(player.x, player.y);

      const g = this.add.graphics();

      // Outer Pulsing Glow Polygon (Octagon)
      g.lineStyle(3, pColor, 0.9);
      g.fillStyle(pColor, 0.25);

      const points = [];
      const sides = 8;
      const radius = 34;
      for (let i = 0; i < sides; i++) {
        const angle = (i * Math.PI * 2) / sides;
        points.push(new Phaser.Geom.Point(Math.cos(angle) * radius, Math.sin(angle) * radius));
      }
      g.fillPoints(points, true);
      g.strokePoints(points, true);

      // Inner Core Fort Shape
      g.fillStyle(0x0f172a, 1);
      g.fillCircle(0, 0, 20);
      g.lineStyle(2, pColor, 1);
      g.strokeCircle(0, 0, 20);

      // Turret Barrel (Pointed at nearest target or default)
      g.fillStyle(pColor, 1);
      g.fillRect(-4, -22, 8, 16);

      tContainer.add(g);

      // HP Bar above tower
      const hpBarBg = this.add.graphics();
      hpBarBg.fillStyle(0x000000, 0.7);
      hpBarBg.fillRect(-30, -52, 60, 8);

      const hpFillPct = Math.max(0, player.hp / player.maxHp);
      const hpColor = hpFillPct > 0.5 ? 0x22c55e : hpFillPct > 0.25 ? 0xeab308 : 0xef4444;
      hpBarBg.fillStyle(hpColor, 1);
      hpBarBg.fillRect(-29, -51, 58 * hpFillPct, 6);

      tContainer.add(hpBarBg);

      // Name & Level Tag
      const nameText = this.add.text(0, -66, `${player.name} [Lvl ${player.level}]`, {
        fontFamily: 'Outfit, sans-serif',
        fontSize: '12px',
        fontWeight: 'bold',
        fill: isLocal ? '#facc15' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5);

      tContainer.add(nameText);

      this.towersContainer.add(tContainer);
    });

    // 3. RENDER ZOMBIES
    Object.values(state.zombies).forEach(zombie => {
      const zColor = parseInt(zombie.color.replace('#', '0x'), 16);

      const zGraphics = this.add.graphics();
      zGraphics.x = zombie.x;
      zGraphics.y = zombie.y;

      // Zombie Body
      zGraphics.fillStyle(zColor, 0.9);
      zGraphics.lineStyle(2, 0x000000, 0.8);
      zGraphics.fillCircle(0, 0, zombie.radius);
      zGraphics.strokeCircle(0, 0, zombie.radius);

      // Zombie Eyes
      zGraphics.fillStyle(0xff0000, 1);
      zGraphics.fillCircle(-4, -3, 2.5);
      zGraphics.fillCircle(4, -3, 2.5);

      // Mini HP bar
      const hpPct = Math.max(0, zombie.hp / zombie.maxHp);
      zGraphics.fillStyle(0x000000, 0.6);
      zGraphics.fillRect(-12, -zombie.radius - 8, 24, 4);
      zGraphics.fillStyle(0xef4444, 1);
      zGraphics.fillRect(-12, -zombie.radius - 8, 24 * hpPct, 4);

      this.zombiesContainer.add(zGraphics);
    });

    // 4. RENDER PROJECTILES
    state.projectiles.forEach(proj => {
      const projColor = parseInt(proj.color.replace('#', '0x'), 16);
      
      this.projectilesGraphics.fillStyle(projColor, 1);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 6);

      // Inner glowing core
      this.projectilesGraphics.fillStyle(0xffffff, 0.9);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 3);
    });

    // 5. RENDER HIT EFFECTS
    state.hitEffects.forEach(fx => {
      const fxColor = parseInt(fx.color.replace('#', '0x'), 16);
      this.fxGraphics.fillStyle(fxColor, 0.8);

      for (let i = 0; i < 5; i++) {
        const ox = (Math.random() - 0.5) * 20;
        const oy = (Math.random() - 0.5) * 20;
        this.fxGraphics.fillCircle(fx.x + ox, fx.y + oy, Math.random() * 3 + 1);
      }

      this.playSynthSound('hit');
    });
  }

  updateLeaderboard(players) {
    const lbContainer = document.getElementById('lb-list');
    lbContainer.innerHTML = '';

    const playerList = Object.values(players).sort((a, b) => b.level - a.level || b.kills - a.kills);

    playerList.forEach(p => {
      const item = document.createElement('div');
      item.className = 'lb-item';
      item.style.opacity = p.alive ? '1' : '0.4';

      item.innerHTML = `
        <div>
          <span class="dot" style="background-color: ${p.color};"></span>
          <span>${p.name} ${p.id === this.localPlayerId ? '(Tú)' : ''}</span>
        </div>
        <div style="color: ${p.alive ? '#facc15' : '#ef4444'};">
          ${p.alive ? `Lvl ${p.level}` : 'DESTRUIDO'}
        </div>
      `;

      lbContainer.appendChild(item);
    });
  }

  showUpgradeModal(options) {
    const modal = document.getElementById('upgrade-modal');
    const container = document.getElementById('perks-container');
    container.innerHTML = '';

    options.forEach(perk => {
      const card = document.createElement('div');
      card.className = 'perk-card';
      card.onclick = () => {
        this.socket.emit('choose_upgrade', perk.id);
        modal.style.display = 'none';
      };

      card.innerHTML = `
        <div class="perk-icon">${perk.icon}</div>
        <div class="perk-name">${perk.title}</div>
        <div class="perk-desc">${perk.desc}</div>
      `;

      container.appendChild(card);
    });

    modal.style.display = 'flex';
  }

  showGameOverModal(isVictory, cause) {
    const modal = document.getElementById('gameover-modal');
    const card = document.getElementById('go-card');
    const title = document.getElementById('go-title');
    const sub = document.getElementById('go-sub');

    if (isVictory) {
      card.className = 'go-card victory';
      title.innerText = '¡VICTORIA REAL!';
      sub.innerText = cause || '¡Has destruido a todos los rivales y dominado la mapa!';
    } else {
      card.className = 'go-card';
      title.innerText = '¡TORRE DESTRUIDA!';
      sub.innerText = `Causa de destrucción: ${cause}`;
    }

    modal.style.display = 'flex';
  }
}

// Global Respawn Helper Function for UI Button
function respawnGame() {
  document.getElementById('gameover-modal').style.display = 'none';
  if (window.gameInstance && window.gameInstance.scene.scenes[0]) {
    const scene = window.gameInstance.scene.scenes[0];
    if (scene.socket) {
      scene.socket.emit('request_respawn');
    }
  }
}

// Initialize Phaser Game Configuration
const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: 'game-container',
  backgroundColor: '#0b0c10',
  scene: [MainScene],
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  }
};

window.gameInstance = new Phaser.Game(config);
