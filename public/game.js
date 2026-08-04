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
    this.isPlacementMode = false;
    this.playerName = '';

    // Render containers for depth management
    this.bgGraphics = this.add.graphics();
    this.previewGraphics = this.add.graphics();
    this.rangeGraphics = this.add.graphics();
    this.towersContainer = this.add.container(0, 0);
    this.zombiesContainer = this.add.container(0, 0);
    this.projectilesGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();

    // Map bounds
    this.cameras.main.setBounds(0, 0, this.mapSize, this.mapSize);
    this.drawMapGrid();

    // Web Audio Synthesizer
    this.initAudio();

    // Setup Socket Listeners
    this.setupSocket();

    // Setup Pointer Events for Tower Placement & Camera Pan
    this.setupInputListeners();

    // Window resize
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
    this.socket.on('connected', (data) => {
      this.mapSize = data.mapSize;
      this.drawMapGrid();
    });

    this.socket.on('init_game', (data) => {
      this.localPlayerId = data.playerId;
      this.isPlacementMode = false;

      document.getElementById('placement-banner').style.display = 'none';
      document.getElementById('hud-overlay').style.display = 'flex';

      if (data.player) {
        this.cameras.main.centerOn(data.player.x, data.player.y);
      }
    });

    this.socket.on('state_update', (data) => {
      this.renderGameState(data);
    });

    this.socket.on('wave_started', (data) => {
      const btn = document.getElementById('btn-next-wave');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.innerText = `OLEADA ${data.wave} EN CURSO...`;
      }
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
      if (this.lastStatePlayers && this.lastStatePlayers[this.localPlayerId] && data.winner === this.lastStatePlayers[this.localPlayerId].name) {
        this.showGameOverModal(true, '¡Eres el último superviviente!');
      }
    });

    this.socket.on('reset_to_start', () => {
      this.localPlayerId = null;
      this.isPlacementMode = false;
      document.getElementById('hud-overlay').style.display = 'none';
      document.getElementById('start-screen-modal').style.display = 'flex';
      this.cameras.main.centerOn(this.mapSize / 2, this.mapSize / 2);
    });
  }

  setupInputListeners() {
    // Placement click listener
    this.input.on('pointerdown', (pointer) => {
      if (this.isPlacementMode) {
        const placeX = Math.round(pointer.worldX);
        const placeY = Math.round(pointer.worldY);

        this.socket.emit('join_game', {
          name: this.playerName,
          x: placeX,
          y: placeY
        });

        this.previewGraphics.clear();
      }
    });

    // Ghost tower preview on mousemove
    this.input.on('pointermove', (pointer) => {
      if (this.isPlacementMode) {
        const g = this.previewGraphics;
        g.clear();

        const x = pointer.worldX;
        const y = pointer.worldY;

        // Attack Range Ghost Ring
        g.lineStyle(2, 0x38bdf8, 0.6);
        g.fillStyle(0x38bdf8, 0.1);
        g.fillCircle(x, y, 330);
        g.strokeCircle(x, y, 330);

        // Tower Ghost Polygon
        g.lineStyle(3, 0xfacc15, 0.9);
        g.fillStyle(0xfacc15, 0.4);
        g.fillCircle(x, y, 24);
        g.strokeCircle(x, y, 24);
      }
    });
  }

  drawMapGrid() {
    const g = this.bgGraphics;
    g.clear();

    g.fillStyle(0x0f172a, 1);
    g.fillRect(0, 0, this.mapSize, this.mapSize);

    g.lineStyle(1, 0x1e293b, 0.6);
    const gridSize = 100;
    for (let x = 0; x <= this.mapSize; x += gridSize) {
      g.lineBetween(x, 0, x, this.mapSize);
    }
    for (let y = 0; y <= this.mapSize; y += gridSize) {
      g.lineBetween(0, y, this.mapSize, y);
    }

    g.lineStyle(6, 0xef4444, 0.8);
    g.strokeRect(0, 0, this.mapSize, this.mapSize);
  }

  renderGameState(state) {
    this.lastStatePlayers = state.players;
    const localPlayer = state.players[this.localPlayerId];

    // Smooth Camera Following
    if (localPlayer && localPlayer.alive) {
      this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, localPlayer.x - this.cameras.main.width / 2, 0.1);
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, localPlayer.y - this.cameras.main.height / 2, 0.1);

      // HUD Stats Update
      document.getElementById('hp-text').innerText = `${Math.round(localPlayer.hp)} / ${localPlayer.maxHp}`;
      const hpPct = Math.max(0, (localPlayer.hp / localPlayer.maxHp) * 100);
      document.getElementById('hp-fill').style.width = `${hpPct}%`;

      document.getElementById('level-badge').innerText = `NIVEL ${localPlayer.level}`;
      document.getElementById('xp-text').innerText = `${localPlayer.xp} / ${localPlayer.xpToNextLevel} XP`;
      const xpPct = Math.min(100, (localPlayer.xp / localPlayer.xpToNextLevel) * 100);
      document.getElementById('xp-fill').style.width = `${xpPct}%`;

      document.getElementById('coins-text').innerText = localPlayer.coins;
      document.getElementById('kills-text').innerText = localPlayer.kills;
      
      // Update Wave Button State
      const btn = document.getElementById('btn-next-wave');
      const playerZombies = Object.values(state.zombies).filter(z => z.targetPlayerId === this.localPlayerId);
      
      if (btn) {
        if (playerZombies.length === 0) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.innerText = `⚡ INICIAR OLEADA ${localPlayer.waveActive ? localPlayer.wave + 1 : localPlayer.wave}`;
        } else {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.innerText = `OLEADA ${localPlayer.wave} (${playerZombies.length} Zombis restantes)`;
        }
      }
    }

    this.updateLeaderboard(state.players);

    this.rangeGraphics.clear();
    this.projectilesGraphics.clear();
    this.fxGraphics.clear();
    this.towersContainer.removeAll(true);
    this.zombiesContainer.removeAll(true);

    // RENDER RANGES FOR LOCAL PLAYER
    if (localPlayer && localPlayer.alive) {
      const colorNum = parseInt(localPlayer.color.replace('#', '0x'), 16);

      this.rangeGraphics.lineStyle(2, 0xffffff, 0.15);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.visionRange);

      this.rangeGraphics.lineStyle(2, colorNum, 0.4);
      this.rangeGraphics.fillStyle(colorNum, 0.05);
      this.rangeGraphics.fillCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange);
    }

    // RENDER PLAYERS & TOWERS
    Object.values(state.players).forEach(player => {
      if (!player.alive) return;

      const pColor = parseInt(player.color.replace('#', '0x'), 16);
      const isLocal = player.id === this.localPlayerId;

      const tContainer = this.add.container(player.x, player.y);
      const g = this.add.graphics();

      // Outer Octagon Fort
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

      // Turret Barrel
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

    // RENDER ZOMBIES
    Object.values(state.zombies).forEach(zombie => {
      const zColor = parseInt(zombie.color.replace('#', '0x'), 16);

      const zGraphics = this.add.graphics();
      zGraphics.x = zombie.x;
      zGraphics.y = zombie.y;

      zGraphics.fillStyle(zColor, 0.9);
      zGraphics.lineStyle(2, 0x000000, 0.8);
      zGraphics.fillCircle(0, 0, zombie.radius);
      zGraphics.strokeCircle(0, 0, zombie.radius);

      zGraphics.fillStyle(0xff0000, 1);
      zGraphics.fillCircle(-4, -3, 2.5);
      zGraphics.fillCircle(4, -3, 2.5);

      const hpPct = Math.max(0, zombie.hp / zombie.maxHp);
      zGraphics.fillStyle(0x000000, 0.6);
      zGraphics.fillRect(-12, -zombie.radius - 8, 24, 4);
      zGraphics.fillStyle(0xef4444, 1);
      zGraphics.fillRect(-12, -zombie.radius - 8, 24 * hpPct, 4);

      this.zombiesContainer.add(zGraphics);
    });

    // RENDER PROJECTILES
    state.projectiles.forEach(proj => {
      const projColor = parseInt(proj.color.replace('#', '0x'), 16);
      
      this.projectilesGraphics.fillStyle(projColor, 1);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 6);

      this.projectilesGraphics.fillStyle(0xffffff, 0.9);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 3);
    });

    // RENDER HIT EFFECTS
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
    if (!lbContainer) return;
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
      sub.innerText = cause || '¡Has destruido a todos los rivales!';
    } else {
      card.className = 'go-card';
      title.innerText = '¡TORRE DESTRUIDA!';
      sub.innerText = `Causa: ${cause}`;
    }

    modal.style.display = 'flex';
  }
}

// Global Start & Wave Helpers
function enterPlacementMode() {
  const nameInput = document.getElementById('player-name-input');
  const name = nameInput.value.trim();

  document.getElementById('start-screen-modal').style.display = 'none';
  document.getElementById('placement-banner').style.display = 'block';

  if (window.gameInstance && window.gameInstance.scene.scenes[0]) {
    const scene = window.gameInstance.scene.scenes[0];
    scene.playerName = name;
    scene.isPlacementMode = true;
  }
}

function triggerNextWave() {
  if (window.gameInstance && window.gameInstance.scene.scenes[0]) {
    const scene = window.gameInstance.scene.scenes[0];
    if (scene.socket) {
      scene.socket.emit('start_next_wave');
    }
  }
}

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
