// Client-side Phaser 3 + Socket.io Game Controller (Enhanced Dynamic Animations & Procedural Zombie Monsters)

class MainScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainScene' });
  }

  preload() {
    // Procedural Graphics
  }

  create() {
    this.socket = io();
    this.localPlayerId = null;
    this.mapSize = 2000;
    this.isPlacementMode = false;
    this.playerName = '';
    this.shopItems = {};

    this.bgParticles = [];
    for (let i = 0; i < 60; i++) {
      this.bgParticles.push({
        x: Math.random() * this.mapSize,
        y: Math.random() * this.mapSize,
        radius: Math.random() * 2 + 1,
        alpha: Math.random() * 0.4 + 0.1,
        speedX: (Math.random() - 0.5) * 10,
        speedY: (Math.random() - 0.5) * 10
      });
    }

    this.floatingTexts = [];
    this.turretAngles = {};

    this.bgGraphics = this.add.graphics();
    this.previewGraphics = this.add.graphics();
    this.rangeGraphics = this.add.graphics();
    this.towersContainer = this.add.container(0, 0);
    this.zombiesContainer = this.add.container(0, 0);
    this.projectilesGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();

    this.cameras.main.setBounds(0, 0, this.mapSize, this.mapSize);

    this.initAudio();
    this.setupSocket();
    this.setupInputListeners();

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
      osc.frequency.setValueAtTime(650, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'hit') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'levelup') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.exponentialRampToValueAtTime(900, now + 0.25);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'buy') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(350, now);
      osc.frequency.exponentialRampToValueAtTime(700, now + 0.18);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
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
      this.shopItems = data.shopItems || {};
    });

    this.socket.on('init_game', (data) => {
      this.localPlayerId = data.playerId;
      this.shopItems = data.shopItems || this.shopItems;
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

    this.socket.on('shop_purchase_success', (data) => {
      this.playSynthSound('buy');
      this.renderShopCards(data.player);
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

    this.socket.on('upgrade_applied', () => {
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
      document.getElementById('shop-modal').style.display = 'none';
      document.getElementById('start-screen-modal').style.display = 'flex';
      this.cameras.main.centerOn(this.mapSize / 2, this.mapSize / 2);
    });
  }

  setupInputListeners() {
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

    this.input.on('pointermove', (pointer) => {
      if (this.isPlacementMode) {
        const g = this.previewGraphics;
        g.clear();

        const x = pointer.worldX;
        const y = pointer.worldY;

        g.lineStyle(2, 0x38bdf8, 0.6);
        g.fillStyle(0x38bdf8, 0.1);
        g.fillCircle(x, y, 330);
        g.strokeCircle(x, y, 330);

        g.lineStyle(3, 0xfacc15, 0.9);
        g.fillStyle(0xfacc15, 0.4);
        g.fillCircle(x, y, 24);
        g.strokeCircle(x, y, 24);
      }
    });
  }

  spawnFloatingText(x, y, text, color = '#ff4757') {
    const txtObj = this.add.text(x + (Math.random() * 20 - 10), y - 10, text, {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '15px',
      fontWeight: '800',
      fill: color,
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5);

    this.tweens.add({
      targets: txtObj,
      y: y - 45,
      alpha: 0,
      duration: 850,
      ease: 'Power2',
      onComplete: () => {
        txtObj.destroy();
      }
    });
  }

  drawMapGrid(time = 0) {
    const g = this.bgGraphics;
    g.clear();

    g.fillStyle(0x0a0d17, 1);
    g.fillRect(0, 0, this.mapSize, this.mapSize);

    g.lineStyle(1, 0x1e293b, 0.5);
    const gridSize = 100;
    for (let x = 0; x <= this.mapSize; x += gridSize) {
      g.lineBetween(x, 0, x, this.mapSize);
    }
    for (let y = 0; y <= this.mapSize; y += gridSize) {
      g.lineBetween(0, y, this.mapSize, y);
    }

    const dt = 0.016;
    this.bgParticles.forEach(p => {
      p.x = (p.x + p.speedX * dt + this.mapSize) % this.mapSize;
      p.y = (p.y + p.speedY * dt + this.mapSize) % this.mapSize;
      
      const pAlpha = p.alpha + Math.sin(time * 0.002 + p.x) * 0.15;
      g.fillStyle(0x38bdf8, Math.max(0.05, Math.min(0.7, pAlpha)));
      g.fillCircle(p.x, p.y, p.radius);
    });

    const borderGlow = 0.6 + Math.sin(time * 0.003) * 0.2;
    g.lineStyle(8, 0xef4444, borderGlow);
    g.strokeRect(0, 0, this.mapSize, this.mapSize);
  }

  renderGameState(state) {
    const time = this.time.now;
    this.drawMapGrid(time);

    this.lastStatePlayers = state.players;
    const localPlayer = state.players[this.localPlayerId];

    if (localPlayer && localPlayer.alive) {
      this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, localPlayer.x - this.cameras.main.width / 2, 0.1);
      this.cameras.main.scrollY = Phaser.Math.Linear(this.cameras.main.scrollY, localPlayer.y - this.cameras.main.height / 2, 0.1);

      document.getElementById('hp-text').innerText = `${Math.round(localPlayer.hp)} / ${localPlayer.maxHp} ${localPlayer.shieldHp > 0 ? `(+${Math.round(localPlayer.shieldHp)} 🛡️)` : ''}`;
      const hpPct = Math.max(0, (localPlayer.hp / localPlayer.maxHp) * 100);
      document.getElementById('hp-fill').style.width = `${hpPct}%`;

      const shieldPct = Math.min(100, (localPlayer.shieldHp / (localPlayer.maxShieldHp || 1)) * 100);
      document.getElementById('shield-fill').style.width = `${localPlayer.shieldHp > 0 ? shieldPct : 0}%`;

      document.getElementById('level-badge').innerText = `NIVEL ${localPlayer.level}`;
      document.getElementById('xp-text').innerText = `${localPlayer.xp} / ${localPlayer.xpToNextLevel} XP`;
      const xpPct = Math.min(100, (localPlayer.xp / localPlayer.xpToNextLevel) * 100);
      document.getElementById('xp-fill').style.width = `${xpPct}%`;

      document.getElementById('coins-text').innerText = localPlayer.coins;
      document.getElementById('kills-text').innerText = localPlayer.kills;
      
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

      if (document.getElementById('shop-modal').style.display === 'flex') {
        this.updateShopAffordability(localPlayer);
      }
    }

    this.updateLeaderboard(state.players);

    this.rangeGraphics.clear();
    this.projectilesGraphics.clear();
    this.fxGraphics.clear();
    this.towersContainer.removeAll(true);
    this.zombiesContainer.removeAll(true);

    // 1. DYNAMIC ATTACK & VISION RANGES
    if (localPlayer && localPlayer.alive) {
      const colorNum = parseInt(localPlayer.color.replace('#', '0x'), 16);

      this.rangeGraphics.lineStyle(2, 0xffffff, 0.15);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.visionRange);

      const rangePulse = Math.sin(time * 0.004) * 2;
      this.rangeGraphics.lineStyle(2.5, colorNum, 0.45);
      this.rangeGraphics.fillStyle(colorNum, 0.05 + Math.sin(time * 0.003) * 0.02);
      this.rangeGraphics.fillCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange + rangePulse);
      this.rangeGraphics.strokeCircle(localPlayer.x, localPlayer.y, localPlayer.attackRange + rangePulse);
    }

    // 2. TOWERS & ROTATING TURRET BARRELS
    Object.values(state.players).forEach(player => {
      if (!player.alive) return;

      const pColor = parseInt(player.color.replace('#', '0x'), 16);
      const isLocal = player.id === this.localPlayerId;

      const tContainer = this.add.container(player.x, player.y);
      const g = this.add.graphics();

      if (player.shieldHp > 0) {
        const shieldPulse = 44 + Math.sin(time * 0.006) * 3;
        const shieldAlpha = 0.7 + Math.sin(time * 0.008) * 0.2;
        g.lineStyle(4, 0x38bdf8, shieldAlpha);
        g.fillStyle(0x38bdf8, 0.12);
        g.fillCircle(0, 0, shieldPulse);
        g.strokeCircle(0, 0, shieldPulse);
      }

      const pulseRadius = 34 + Math.sin(time * 0.005 + player.x) * 1.5;
      g.lineStyle(3, pColor, 0.9);
      g.fillStyle(pColor, 0.25);

      const points = [];
      const sides = 8;
      for (let i = 0; i < sides; i++) {
        const angle = (i * Math.PI * 2) / sides;
        points.push(new Phaser.Geom.Point(Math.cos(angle) * pulseRadius, Math.sin(angle) * pulseRadius));
      }
      g.fillPoints(points, true);
      g.strokePoints(points, true);

      g.fillStyle(0x0f172a, 1);
      g.fillCircle(0, 0, 20);
      g.lineStyle(2, pColor, 1);
      g.strokeCircle(0, 0, 20);

      let aimAngle = this.turretAngles[player.id] || 0;
      let targetEntity = null;

      let minD = player.attackRange;
      Object.values(state.zombies).forEach(z => {
        const d = Math.hypot(z.x - player.x, z.y - player.y);
        if (d <= minD) { minD = d; targetEntity = z; }
      });
      if (!targetEntity) {
        Object.values(state.players).forEach(p => {
          if (p.id !== player.id && p.alive) {
            const d = Math.hypot(p.x - player.x, p.y - player.y);
            if (d <= minD) { minD = d; targetEntity = p; }
          }
        });
      }

      if (targetEntity) {
        const targetAngle = Phaser.Math.Angle.Between(player.x, player.y, targetEntity.x, targetEntity.y);
        aimAngle = Phaser.Math.Angle.RotateTo(aimAngle, targetAngle, 0.1);
        this.turretAngles[player.id] = aimAngle;
      }

      const barrelG = this.add.graphics();
      barrelG.rotation = aimAngle + Math.PI / 2;
      barrelG.fillStyle(pColor, 1);

      if (player.multiShot > 1) {
        barrelG.fillRect(-10, -24, 6, 18);
        barrelG.fillRect(4, -24, 6, 18);
      } else {
        barrelG.fillRect(-4, -24, 8, 18);
      }
      tContainer.add(barrelG);

      tContainer.add(g);

      const hpBarBg = this.add.graphics();
      hpBarBg.fillStyle(0x000000, 0.7);
      hpBarBg.fillRect(-30, -54, 60, 8);

      const hpFillPct = Math.max(0, player.hp / player.maxHp);
      const hpColor = hpFillPct > 0.5 ? 0x22c55e : hpFillPct > 0.25 ? 0xeab308 : 0xef4444;
      hpBarBg.fillStyle(hpColor, 1);
      hpBarBg.fillRect(-29, -53, 58 * hpFillPct, 6);

      tContainer.add(hpBarBg);

      const nameText = this.add.text(0, -68, `${player.name} [Lvl ${player.level}]`, {
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

    // 3. DISTINCT PROCEDURAL MONSTER DESIGNS FOR EACH ZOMBIE VARIANT
    Object.values(state.zombies).forEach(zombie => {
      const zColor = parseInt(zombie.color.replace('#', '0x'), 16);
      const zGraphics = this.add.graphics();

      const seed = zombie.x * 0.1;
      const wobbleX = Math.sin(time * 0.014 + seed) * 2.5;
      const wobbleY = Math.cos(time * 0.014 + seed) * 2.5;

      zGraphics.x = zombie.x + wobbleX;
      zGraphics.y = zombie.y + wobbleY;

      // Rotate zombie head towards target player tower
      let faceAngle = 0;
      if (state.players[zombie.targetPlayerId]) {
        const tp = state.players[zombie.targetPlayerId];
        faceAngle = Math.atan2(tp.y - zombie.y, tp.x - zombie.x);
      }
      zGraphics.rotation = faceAngle;

      if (zombie.type === 'fast') {
        // SLEEK CRAWLER (Neon Yellow Spikes + Tri-eye + Blade Legs)
        zGraphics.fillStyle(0xfacc15, 0.95);
        zGraphics.lineStyle(2, 0x000000, 1);
        
        // Blade Legs twitching
        const legTwitch = Math.sin(time * 0.02 + seed) * 4;
        zGraphics.lineBetween(-4, -10, -12, -16 + legTwitch);
        zGraphics.lineBetween(-4, 10, -12, 16 - legTwitch);
        zGraphics.lineBetween(4, -8, 12, -14 + legTwitch);
        zGraphics.lineBetween(4, 8, 12, 14 - legTwitch);

        // Arrowhead Predator Shell
        zGraphics.fillTriangle(14, 0, -10, -10, -10, 10);
        zGraphics.strokeTriangle(14, 0, -10, -10, -10, 10);

        // Triad Cyb-Eyes
        zGraphics.fillStyle(0xff0055, 1);
        zGraphics.fillCircle(4, 0, 2.5);
        zGraphics.fillCircle(-2, -4, 2);
        zGraphics.fillCircle(-2, 4, 2);

      } else if (zombie.type === 'tank') {
        // ARMORED BEHEMOTH (Dark Red Square + Shoulder Horns + Laser Visor Core)
        zGraphics.fillStyle(0x991b1b, 1);
        zGraphics.lineStyle(3, 0x000000, 1);
        
        // Heavy Shoulder Horn Spikes
        zGraphics.fillTriangle(-2, -22, -12, -14, 6, -14);
        zGraphics.fillTriangle(-2, 22, -12, 14, 6, 14);

        // Armor Plate Shell
        zGraphics.fillRoundedRect(-zombie.radius, -zombie.radius, zombie.radius * 2, zombie.radius * 2, 6);
        zGraphics.strokeRoundedRect(-zombie.radius, -zombie.radius, zombie.radius * 2, zombie.radius * 2, 6);

        // Pulsing Core Center
        const coreGlow = 0.5 + Math.sin(time * 0.008) * 0.3;
        zGraphics.fillStyle(0xf97316, coreGlow);
        zGraphics.fillCircle(0, 0, 8);

        // Glowing Red Laser Slit Visor
        zGraphics.fillStyle(0xef4444, 1);
        zGraphics.fillRect(6, -8, 4, 16);

      } else if (zombie.type === 'boss') {
        // MUTANT BOSS DEMON (Giant Purple Octagon + Gold Horns + 4 Red Eyes)
        zGraphics.fillStyle(0x6b21a8, 0.95);
        zGraphics.lineStyle(3, 0xfacc15, 0.9);

        // Gold Demon Horns
        zGraphics.fillTriangle(8, -20, 20, -28, 2, -12);
        zGraphics.fillTriangle(8, 20, 20, 28, 2, 12);

        // Main Boss Body
        zGraphics.fillCircle(0, 0, zombie.radius);
        zGraphics.strokeCircle(0, 0, zombie.radius);

        // Inner Void Core
        zGraphics.fillStyle(0x1e1b4b, 1);
        zGraphics.fillCircle(0, 0, 12);

        // 4 Glowing Eyes
        zGraphics.fillStyle(0xff0000, 1);
        zGraphics.fillCircle(8, -6, 3);
        zGraphics.fillCircle(8, 6, 3);
        zGraphics.fillCircle(0, -8, 2.5);
        zGraphics.fillCircle(0, 8, 2.5);

      } else {
        // NORMAL MUTANT RUNNER (Organic Toxic Spikes + Fangs + Glowing Eyes)
        zGraphics.fillStyle(zColor, 0.95);
        zGraphics.lineStyle(2, 0x000000, 0.9);

        // Back Spikes
        const spikePulse = Math.sin(time * 0.01 + seed) * 2;
        zGraphics.fillTriangle(-10, -10, -16 - spikePulse, -6, -6, -2);
        zGraphics.fillTriangle(-10, 10, -16 - spikePulse, 6, -6, 2);

        // Main Body
        zGraphics.fillCircle(0, 0, zombie.radius);
        zGraphics.strokeCircle(0, 0, zombie.radius);

        // Sharp White Fangs
        zGraphics.fillStyle(0xffffff, 1);
        zGraphics.fillTriangle(zombie.radius - 2, -4, zombie.radius + 5, -2, zombie.radius - 2, 0);
        zGraphics.fillTriangle(zombie.radius - 2, 0, zombie.radius + 5, 2, zombie.radius - 2, 4);

        // Glowing Eyes
        const eyeGlow = 0.8 + Math.sin(time * 0.01 + seed) * 0.2;
        zGraphics.fillStyle(0xff0000, eyeGlow);
        zGraphics.fillCircle(4, -4, 2.5);
        zGraphics.fillCircle(4, 4, 2.5);
      }

      // Mini HP Bar above Zombie
      const hpPct = Math.max(0, zombie.hp / zombie.maxHp);
      zGraphics.fillStyle(0x000000, 0.7);
      zGraphics.fillRect(-14, -zombie.radius - 12, 28, 5);
      zGraphics.fillStyle(zombie.type === 'boss' ? 0xa855f7 : 0xef4444, 1);
      zGraphics.fillRect(-13, -zombie.radius - 11, 26 * hpPct, 3);

      this.zombiesContainer.add(zGraphics);
    });

    // 4. PROJECTILES WITH TRAIL LINES
    state.projectiles.forEach(proj => {
      const projColor = parseInt(proj.color.replace('#', '0x'), 16);
      
      const angle = Math.atan2(proj.targetY - proj.y, proj.targetX - proj.x);
      const tailLen = 14;
      const tailX = proj.x - Math.cos(angle) * tailLen;
      const tailY = proj.y - Math.sin(angle) * tailLen;

      this.projectilesGraphics.lineStyle(4, projColor, 0.6);
      this.projectilesGraphics.lineBetween(proj.x, proj.y, tailX, tailY);

      this.projectilesGraphics.fillStyle(projColor, 1);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 6);

      this.projectilesGraphics.fillStyle(0xffffff, 0.95);
      this.projectilesGraphics.fillCircle(proj.x, proj.y, 3);
    });

    // 5. HIT IMPACTS & FLOATING DAMAGE TEXT
    state.hitEffects.forEach(fx => {
      const fxColor = parseInt(fx.color.replace('#', '0x'), 16);

      if (fx.radius) {
        this.fxGraphics.lineStyle(3, 0xf97316, 0.9);
        this.fxGraphics.fillStyle(0xf97316, 0.35);
        this.fxGraphics.fillCircle(fx.x, fx.y, fx.radius);
        this.fxGraphics.strokeCircle(fx.x, fx.y, fx.radius);
      } else {
        this.fxGraphics.fillStyle(fxColor, 0.9);
        for (let i = 0; i < 6; i++) {
          const ox = (Math.random() - 0.5) * 24;
          const oy = (Math.random() - 0.5) * 24;
          this.fxGraphics.fillCircle(fx.x + ox, fx.y + oy, Math.random() * 4 + 1.5);
        }

        this.spawnFloatingText(fx.x, fx.y, '-35', fx.color === '#FF4757' ? '#ef4444' : '#facc15');
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

  updateShopAffordability(localPlayer) {
    if (!this.shopItems || !localPlayer) return;
    Object.keys(this.shopItems).forEach(itemId => {
      const btn = document.getElementById(`btn-buy-${itemId}`);
      const lvlTag = document.getElementById(`level-tag-${itemId}`);
      const item = this.shopItems[itemId];
      if (btn && item) {
        const level = (localPlayer.shopPurchases) ? (localPlayer.shopPurchases[itemId] || 0) : 0;
        const cost = Math.round(item.baseCost * Math.pow(1.35, level));
        const canAfford = localPlayer.coins >= cost;
        btn.disabled = !canAfford;
        btn.innerHTML = `${cost} 🪙`;
        if (lvlTag) lvlTag.innerText = `NIVEL ${level}`;
      }
    });
  }

  renderShopCards(localPlayer) {
    const container = document.getElementById('shop-grid-container');
    if (!container || !this.shopItems) return;

    container.innerHTML = '';

    Object.keys(this.shopItems).forEach(itemId => {
      const item = this.shopItems[itemId];
      const level = (localPlayer && localPlayer.shopPurchases) ? (localPlayer.shopPurchases[itemId] || 0) : 0;
      const cost = Math.round(item.baseCost * Math.pow(1.35, level));

      const card = document.createElement('div');
      card.className = 'shop-card';

      const canAfford = localPlayer && localPlayer.coins >= cost;

      card.innerHTML = `
        <div class="shop-card-top">
          <div class="shop-card-icon">${item.icon}</div>
          <div class="shop-card-info">
            <h4>${item.name}</h4>
            <p>${item.desc}</p>
          </div>
        </div>
        <div class="shop-card-bottom">
          <div class="shop-level-tag" id="level-tag-${itemId}">NIVEL ${level}</div>
          <button id="btn-buy-${itemId}" class="btn-buy" ${canAfford ? '' : 'disabled'} onclick="buyShopItem('${itemId}')">
            ${cost} 🪙
          </button>
        </div>
      `;

      container.appendChild(card);
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

function toggleCoinShop() {
  const modal = document.getElementById('shop-modal');
  if (!modal) return;

  const isVisible = modal.style.display === 'flex';
  modal.style.display = isVisible ? 'none' : 'flex';

  if (!isVisible && window.gameInstance && window.gameInstance.scene.scenes[0]) {
    const scene = window.gameInstance.scene.scenes[0];
    if (scene.lastStatePlayers && scene.localPlayerId) {
      scene.renderShopCards(scene.lastStatePlayers[scene.localPlayerId]);
    }
  }
}

function buyShopItem(itemId) {
  if (window.gameInstance && window.gameInstance.scene.scenes[0]) {
    const scene = window.gameInstance.scene.scenes[0];
    if (scene.socket) {
      scene.socket.emit('buy_shop_item', itemId);
    }
  }
}

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
