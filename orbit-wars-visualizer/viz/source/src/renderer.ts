console.log('renderer.ts loading...');
// Inlined core types and utilities to remove build dependencies
export interface RendererOptions {
  step: number;
  replay: any;
  parent: HTMLElement;
  agents?: any[];
}

export function getStepData(replay: any, step: number): any[] | null {
  if (!replay?.steps || !Array.isArray(replay.steps) || step < 0 || step >= replay.steps.length) {
    return null;
  }
  return replay.steps[step];
}

// Game constants
const BOARD_SIZE = 100;
const CENTER = 50;
const SUN_RADIUS = 10;

// Wong palette — colorblind-safe (blue, orange, teal, yellow)
const PLAYER_COLORS = ['#0072B2', '#E69F00', '#009E73', '#F0E442'];
const NEUTRAL_COLOR = '#666666';

// Text size presets: [planetFont, deltaFont, fleetFont, stepFont]
const TEXT_SIZES: Record<string, number> = {
  small: 0.7,
  medium: 1.0,
  large: 1.4,
};

function getPlayerColor(owner: number): string {
  if (owner < 0 || owner >= PLAYER_COLORS.length) return NEUTRAL_COLOR;
  return PLAYER_COLORS[owner];
}

interface Planet {
  id: number;
  owner: number;
  x: number;
  y: number;
  radius: number;
  ships: number;
  production: number;
}

interface Fleet {
  id: number;
  owner: number;
  x: number;
  y: number;
  angle: number;
  fromPlanetId: number;
  ships: number;
}

function parsePlanet(p: number[]): Planet {
  return { id: p[0], owner: p[1], x: p[2], y: p[3], radius: p[4], ships: p[5], production: p[6] };
}

function parseFleet(f: number[]): Fleet {
  return { id: f[0], owner: f[1], x: f[2], y: f[3], angle: f[4], fromPlanetId: f[5], ships: f[6] };
}

// --- Settings persistence via data attributes on parent ---
interface Settings {
  showFleetNumbers: boolean;
  showProductionDots: boolean;
  textSize: string; // 'small' | 'medium' | 'large'
}

function getSettings(parent: HTMLElement): Settings {
  return {
    showFleetNumbers: parent.dataset.showFleetNumbers !== 'false',
    showProductionDots: parent.dataset.showProductionDots !== 'false',
    textSize: parent.dataset.textSize || 'medium',
  };
}

function setSetting(parent: HTMLElement, key: string, value: string) {
  parent.dataset[key] = value;
}

export default function renderer(options: RendererOptions) {
  console.log('Renderer function called for step:', options.step);
  const { step, replay, parent, agents } = options;

  const stepData = getStepData(replay, step);
  if (!stepData || !(stepData as any)[0]?.observation) return;

  const settings = getSettings(parent);
  const textScale = TEXT_SIZES[settings.textSize] || 1.0;

  const obs = (stepData as any)[0].observation;
  const planets: Planet[] = (obs.planets || []).map(parsePlanet);
  const fleets: Fleet[] = (obs.fleets || []).map(parseFleet);
  const cometPlanetIds = new Set<number>(obs.comet_planet_ids || []);
  const numAgents = (replay as any).info?.TeamNames?.length || 2;

  // Previous step for diff detection
  let prevObs: any = null;
  if (step > 0) {
    const prevStep = getStepData(replay, step - 1);
    if (prevStep) prevObs = (prevStep as any)[0]?.observation;
  }

  // Build previous planet map for diff
  const prevPlanetMap = new Map<number, Planet>();
  if (prevObs?.planets) {
    for (const p of prevObs.planets) {
      const pp = parsePlanet(p);
      prevPlanetMap.set(pp.id, pp);
    }
  }

  // Detect game over
  const statuses = (stepData as any).map ? Array.from(stepData as any).map((s: any) => s?.status) : [];
  const isGameOver = statuses.some((s: string) => s === 'DONE');

  // Compute scores
  const playerScores: number[] = [];
  for (let i = 0; i < numAgents; i++) {
    let score = 0;
    for (const p of planets) {
      if (p.owner === i) score += Math.floor(p.ships);
    }
    for (const f of fleets) {
      if (f.owner === i) score += Math.floor(f.ships);
    }
    playerScores.push(score);
  }

  // Compute planets count
  const playerPlanets: number[] = new Array(numAgents).fill(0);
  for (const p of planets) {
    if (p.owner >= 0 && p.owner < numAgents) playerPlanets[p.owner]++;
  }

  // Determine active players (those with planets or fleets)
  const activePlayers = new Set<number>();
  for (const p of planets) {
    if (p.owner >= 0) activePlayers.add(p.owner);
  }
  for (const f of fleets) {
    activePlayers.add(f.owner);
  }

  // Compute advantage
  const totalShips = playerScores.reduce((a, b) => a + b, 0) || 1;
  const p0Advantage = (playerScores[0] / totalShips) * 100;

  // Rebuild DOM
  parent.innerHTML = `
    <div class="renderer-container">
      <div class="tactical-title" style="font-family: 'Orbitron', sans-serif; font-size: 0.65rem; color: #4a9eff; letter-spacing: 6px; margin: 4px 0 8px 0; opacity: 0.7; text-transform: uppercase; display: flex; align-items: center; gap: 12px;">
        <span style="width: 20px; height: 1px; background: currentColor; opacity: 0.3;"></span>
        Orbit Wars // Tactical Command
        <span style="width: 20px; height: 1px; background: currentColor; opacity: 0.3;"></span>
      </div>
      <div class="header"></div>
      <div class="advantage-bar-wrapper" style="width: 100%; max-width: 600px; height: 6px; background: ${PLAYER_COLORS[1]}; border-radius: 3px; margin: 4px 0 12px 0; overflow: hidden; display: flex; box-shadow: 0 0 10px rgba(0,0,0,0.5);">
        <div class="advantage-fill" style="width: ${p0Advantage}%; height: 100%; background: ${PLAYER_COLORS[0]}; transition: width 500ms cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 2px 0 5px rgba(0,0,0,0.3); z-index: 2;"></div>
      </div>
      <div class="controls-bar"></div>
      <div class="viewport-main" style="display: flex; flex: 1; width: 100%; min-height: 0; gap: 12px; padding: 0 12px;">
        <div class="side-stats player-0" style="width: 160px; display: flex; flex-direction: column; gap: 12px; padding-top: 20px;"></div>
        <div class="canvas-wrapper" style="flex: 1; position: relative; min-width: 0;">
          <canvas></canvas>
        </div>
        <div class="side-stats player-1" style="width: 160px; display: flex; flex-direction: column; gap: 12px; padding-top: 20px;"></div>
      </div>
    </div>
  `;

  const header = parent.querySelector('.header') as HTMLDivElement;
  const controlsBar = parent.querySelector('.controls-bar') as HTMLDivElement;
  const sideLeft = parent.querySelector('.side-stats.player-0') as HTMLDivElement;
  const sideRight = parent.querySelector('.side-stats.player-1') as HTMLDivElement;
  const canvas = parent.querySelector('canvas') as HTMLCanvasElement;
  const canvasWrapper = canvas.parentElement as HTMLDivElement;
  if (!canvas || !replay) return;

  // --- Side Stats ---
  const totalPlanetsAvailable = planets.length || 32;
  const maxExpectedShips = 600; // Cap for scaling bars

  // --- Sparkline Helper ---
  const renderSparkline = (data: number[], color: string, height: number = 30) => {
    if (data.length < 2) return '';
    const max = Math.max(...data, 1);
    const min = Math.min(...data);
    const range = max - min || 1;
    const width = 120; // Matches sidebar width mostly
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((d - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');

    return `
      <svg width="${width}" height="${height}" style="overflow: visible; margin-top: 4px; display: block;">
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.8; filter: drop-shadow(0 0 2px ${color}66)" />
        <circle cx="${(data.length - 1) / (data.length - 1) * width}" cy="${height - ((data[data.length - 1] - min) / range) * height}" r="2" fill="${color}" />
      </svg>
    `;
  };

  const renderSidePanel = (el: HTMLElement, idx: number) => {
    if (!el) return;
    const color = getPlayerColor(idx);
    const score = playerScores[idx] || 0;
    const planetCount = playerPlanets[idx] || 0;
    const teamName = (replay as any).info?.TeamNames?.[idx];
    const name = agents?.[idx]?.name || teamName || `Player ${idx + 1}`;

    // Compute trends up to current step
    const scoreTrend: number[] = [];
    const planetTrend: number[] = [];
    const actionTrend: number[] = [];
    const stride = Math.max(1, Math.floor(step / 40)); // Max 40 points in sparkline
    for (let i = 0; i <= step; i += stride) {
      const sData = getStepData(replay, i);
      if (!sData) continue;
      const agentStep = (sData as any)[idx];
      const sObs = agentStep?.observation || {};
      const sPlanets = sObs.planets || [];
      const sFleets = sObs.fleets || [];
      const sActions = agentStep?.action || [];

      let sScore = 0;
      let sPlanetsCount = 0;
      for (const p of sPlanets) {
        if (p[1] === idx) {
          sScore += Math.floor(p[5]);
          sPlanetsCount++;
        }
      }
      for (const f of sFleets) {
        if (f[1] === idx) sScore += Math.floor(f[6]);
      }
      scoreTrend.push(sScore);
      planetTrend.push(sPlanetsCount);
      actionTrend.push(sActions.length);
    }
    // Always include current step if it was skipped by stride
    if (step % stride !== 0) {
      scoreTrend.push(score);
      planetTrend.push(planetCount);
      const currentStepData = getStepData(replay, step);
      const currentActions = (currentStepData as any)?.[idx]?.action || [];
      actionTrend.push(currentActions.length);
    }

    // Mission History logic (only if available in replay)
    const missionHistory = (replay as any).mission_history || [];
    const cumulativeMissions: Record<string, number> = {};
    let totalMissions = 0;

    // We only show mission stats for Player 0 (assumed to be the RL agent we're monitoring)
    // or if the replay provides it for that specific agent.
    // In our current setup, generate_replay only collects mission_history for rl_mission (player 0)
    if (idx === 0 && missionHistory.length > 0) {
      for (const m of missionHistory) {
        if (m.step > step) break;
        for (const [kind, count] of Object.entries(m.counts)) {
          cumulativeMissions[kind] = (cumulativeMissions[kind] || 0) + (count as number);
          totalMissions += (count as number);
        }
      }
    }

    let missionHtml = '';
    if (totalMissions > 0) {
      missionHtml = `
        <div class="stat-box" style="margin-top: 24px; border-top: 1px solid #333; padding-top: 16px;">
          <div style="font-size: 0.7rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Mission Strategy</div>
          ${Object.entries(cumulativeMissions)
          .filter(([_, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([kind, count]) => {
            const pct = (count / totalMissions) * 100;
            return `
                <div style="margin-bottom: 8px;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: #eee; margin-bottom: 2px; font-family: 'JetBrains Mono', monospace;">
                    <span style="font-family: 'Orbitron', sans-serif; letter-spacing: 0.5px;">${kind}</span>
                    <span>${count}</span>
                  </div>
                  <div style="width: 100%; height: 4px; background: #111; border-radius: 2px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${color}; opacity: 0.7;"></div>
                  </div>
                </div>
              `;
          }).join('')}
        </div>
      `;
    }

    el.innerHTML = `
      <div class="side-panel-agent" style="padding: 16px; background: rgba(30, 30, 50, 0.6); border: 1px solid #444; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); height: fit-content;">
        <div style="color: ${color}; font-family: 'Orbitron', sans-serif; font-size: 0.9rem; font-weight: 800; margin-bottom: 16px; border-bottom: 2px solid ${color}44; padding-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; letter-spacing: 1px;">
          ${name}
        </div>
        
        <div class="stat-box" style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
            <div style="font-size: 0.7rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Orbitron', sans-serif;">Ships</div>
            <div style="font-size: 1.4rem; font-weight: 600; color: #fff; font-family: 'JetBrains Mono', monospace;">${score}</div>
          </div>
          <div style="width: 100%; height: 8px; background: #111; border-radius: 4px; border: 1px solid #333; overflow: hidden;">
            <div style="width: ${Math.min(100, (score / maxExpectedShips) * 100)}%; height: 100%; background: ${color}; box-shadow: 0 0 8px ${color}aa; transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);"></div>
          </div>
          ${renderSparkline(scoreTrend, color)}
        </div>

        <div class="stat-box" style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
            <div style="font-size: 0.7rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Orbitron', sans-serif;">Planets</div>
            <div style="font-size: 1.4rem; font-weight: 600; color: #fff; font-family: 'JetBrains Mono', monospace;">${planetCount}</div>
          </div>
          <div style="width: 100%; height: 8px; background: #111; border-radius: 4px; border: 1px solid #333; overflow: hidden;">
            <div style="width: ${Math.min(100, (planetCount / totalPlanetsAvailable) * 100)}%; height: 100%; background: ${color}; box-shadow: 0 0 8px ${color}aa; transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);"></div>
          </div>
          ${renderSparkline(planetTrend, color)}
        </div>

        <div class="stat-box">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
            <div style="font-size: 0.7rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Orbitron', sans-serif;">APM</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #fff; font-family: 'JetBrains Mono', monospace;">${actionTrend[actionTrend.length - 1] || 0} <span style="font-size: 0.65rem; color: #666; font-weight: 400; font-family: 'Inter', sans-serif; text-transform: uppercase;">moves/turn</span></div>
          </div>
          ${renderSparkline(actionTrend, '#777', 20)}
        </div>
        
        ${missionHtml}
      </div>
    `;
  };

  renderSidePanel(sideLeft, 0);
  if (numAgents > 1) renderSidePanel(sideRight, 1);

  // --- Controls bar ---
  const fleetBtnActive = settings.showFleetNumbers ? ' active' : '';
  const prodBtnActive = settings.showProductionDots ? ' active' : '';
  controlsBar.innerHTML =
    `<button class="ctrl-btn${fleetBtnActive}" data-action="toggle-fleet-numbers">` +
    `Fleet #</button>` +
    `<button class="ctrl-btn${prodBtnActive}" data-action="toggle-production-dots">` +
    `Production</button>` +
    `<span class="ctrl-group">` +
    `<span class="ctrl-label">Text:</span>` +
    ['small', 'medium', 'large']
      .map((sz) => {
        const active = settings.textSize === sz ? ' active' : '';
        return `<button class="ctrl-btn${active}" data-action="text-size" data-value="${sz}">${sz[0].toUpperCase() + sz.slice(1)}</button>`;
      })
      .join('') +
    `</span>`;

  // Wire up control event listeners (these mutate data attrs and re-render)
  controlsBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'toggle-fleet-numbers') {
      setSetting(parent, 'showFleetNumbers', settings.showFleetNumbers ? 'false' : 'true');
      renderer(options);
    } else if (action === 'toggle-production-dots') {
      setSetting(parent, 'showProductionDots', settings.showProductionDots ? 'false' : 'true');
      renderer(options);
    } else if (action === 'text-size') {
      setSetting(parent, 'textSize', btn.dataset.value || 'medium');
      renderer(options);
    }
  });

  // Size canvas: always square, fill available space, handle DPR
  const dpr = window.devicePixelRatio || 1;
  const wrapperRect = canvasWrapper.getBoundingClientRect();
  const cssSize = Math.max(100, Math.floor(Math.min(wrapperRect.width, wrapperRect.height)));
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  canvas.style.position = 'absolute';
  canvas.style.left = `${(wrapperRect.width - cssSize) / 2}px`;
  canvas.style.top = `${(wrapperRect.height - cssSize) / 2}px`;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);

  const c = canvas.getContext('2d');
  if (!c) return;
  c.scale(dpr, dpr);

  // All drawing uses CSS pixels; the DPR scaling handles sharpness
  const w = cssSize;
  const scale = w / BOARD_SIZE;

  // --- Header: player cards ---
  const playerNames: string[] = [];
  for (let i = 0; i < numAgents; i++) {
    const agent = agents?.[i];
    const teamName = (replay as any).info?.TeamNames?.[i];
    playerNames.push(agent?.name || teamName || `Player ${i + 1}`);
  }

  const headerParts: string[] = [];
  for (let i = 0; i < numAgents; i++) {
    const isActive = activePlayers.has(i);
    const activeClass = isActive ? ' active' : '';
    headerParts.push(
      `<span class="player-card${activeClass}">` +
      `<span class="color-dot" style="background-color: ${PLAYER_COLORS[i]}"></span>` +
      `<span class="player-name">${playerNames[i]}</span>` +
      `<span class="ship-count">${playerScores[i]}</span>` +
      `</span>`
    );
    if (i < numAgents - 1) {
      headerParts.push(`<span style="color: #666;">vs</span>`);
    }
  }
  header.innerHTML = headerParts.join('');

  // --- Draw game board on canvas ---
  c.fillStyle = '#050510';
  c.fillRect(0, 0, w, w);

  // Draw technological grid
  c.strokeStyle = 'rgba(74, 158, 255, 0.08)';
  c.lineWidth = 0.5;
  const gridSize = 10;
  for (let x = 0; x <= BOARD_SIZE; x += gridSize) {
    c.beginPath();
    c.moveTo(x * scale, 0);
    c.lineTo(x * scale, w);
    c.stroke();
  }
  for (let y = 0; y <= BOARD_SIZE; y += gridSize) {
    c.beginPath();
    c.moveTo(0, y * scale);
    c.lineTo(w, y * scale);
    c.stroke();
  }

  // Draw sun with glow
  const sunX = CENTER * scale;
  const sunY = CENTER * scale;
  const sunR = SUN_RADIUS * scale;

  const glow = c.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 2.5);
  glow.addColorStop(0, 'rgba(255, 200, 50, 0.6)');
  glow.addColorStop(0.5, 'rgba(255, 150, 20, 0.2)');
  glow.addColorStop(1, 'transparent');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, w);

  // Sun body
  c.beginPath();
  c.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  c.fillStyle = '#FFB800';
  c.fill();
  c.strokeStyle = '#FFD700';
  c.lineWidth = 2;
  c.stroke();

  // Draw comet trails
  if (obs.comets) {
    for (const group of obs.comets) {
      const idx = group.path_index;
      for (let i = 0; i < group.planet_ids.length; i++) {
        const path = group.paths[i];
        const tailLen = Math.min(idx + 1, path.length, 5);
        if (tailLen < 2) continue;
        for (let t = 1; t < tailLen; t++) {
          const pi = idx - t;
          if (pi < 0) break;
          const alpha = 0.4 * (1 - t / tailLen);
          c.beginPath();
          c.moveTo(path[pi + 1][0] * scale, path[pi + 1][1] * scale);
          c.lineTo(path[pi][0] * scale, path[pi][1] * scale);
          c.strokeStyle = `rgba(200, 220, 255, ${alpha})`;
          c.lineWidth = ((2.5 - (1.5 * t) / tailLen) * scale) / 5;
          c.lineCap = 'round';
          c.stroke();
        }
      }
    }
  }

  // --- Detect Impacts for Visual Effects ---
  const impacts: {x: number, y: number, color: string, ships: number}[] = [];
  if (step > 0) {
    const prevData = getStepData(replay, step - 1);
    const currData = getStepData(replay, step);
    if (prevData && currData) {
      const prevFleets = (prevData as any)[0].observation.fleets || [];
      const currFleets = (currData as any)[0].observation.fleets || [];
      const currFleetIds = new Set(currFleets.map((f: any) => f[0]));
      
      for (const f of prevFleets) {
        if (!currFleetIds.has(f[0])) {
          // Fleet disappeared. Calculate distance to sun to see if it was consumed.
          const fx = f[2], fy = f[3];
          const distToSun = Math.sqrt((fx - CENTER) ** 2 + (fy - CENTER) ** 2);
          if (distToSun > SUN_RADIUS + 1) {
            impacts.push({
              x: fx * scale,
              y: fy * scale,
              color: getPlayerColor(f[1]),
              ships: f[6]
            });
          }
        }
      }
    }
  }

  // Draw impacts
  for (const imp of impacts) {
    const r = Math.sqrt(imp.ships) * scale * 0.5;
    
    // Impact Flash
    const grad = c.createRadialGradient(imp.x, imp.y, 0, imp.x, imp.y, r * 2);
    grad.addColorStop(0, imp.color + 'aa');
    grad.addColorStop(1, 'transparent');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(imp.x, imp.y, r * 2, 0, Math.PI * 2);
    c.fill();

    // Tactical Shockwave
    c.beginPath();
    c.arc(imp.x, imp.y, r * 1.5, 0, Math.PI * 2);
    c.strokeStyle = imp.color;
    c.lineWidth = 1;
    c.stroke();

    // Bits/Sparks
    for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        c.beginPath();
        c.moveTo(imp.x + Math.cos(ang) * r, imp.y + Math.sin(ang) * r);
        c.lineTo(imp.x + Math.cos(ang) * r * 2, imp.y + Math.sin(ang) * r * 2);
        c.strokeStyle = imp.color + '88';
        c.stroke();
    }
  }

  // Draw planets
  for (const planet of planets) {
    const px = planet.x * scale;
    const py = planet.y * scale;
    const pr = planet.radius * scale;
    const color = getPlayerColor(planet.owner);
    const isComet = cometPlanetIds.has(planet.id);

    // Check if ownership changed from previous step
    const prev = prevPlanetMap.get(planet.id);
    const ownerChanged = prev && prev.owner !== planet.owner;

    // Planet body
    const isPlayer = planet.owner >= 0;
    
    // Glassmorphic fill with radial highlight
    c.beginPath();
    c.arc(px, py, pr, 0, Math.PI * 2);
    
    const planetGrad = c.createRadialGradient(px - pr*0.3, py - pr*0.3, pr*0.1, px, py, pr);
    if (isPlayer) {
      planetGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      planetGrad.addColorStop(0.3, color + '77');
      planetGrad.addColorStop(1, color + '33');
    } else {
      planetGrad.addColorStop(0, 'rgba(150, 150, 150, 0.2)');
      planetGrad.addColorStop(1, 'rgba(50, 50, 50, 0.1)');
    }
    
    c.fillStyle = planetGrad;
    c.fill();

    // Sharp outer border
    c.strokeStyle = isPlayer ? color : (isComet ? '#88ccff' : 'rgba(255, 255, 255, 0.2)');
    c.lineWidth = (isComet || isPlayer) ? Math.max(1, scale * 0.15) : 0.5;
    c.stroke();

    // Subtle internal "tech" ring
    if (isPlayer) {
      c.beginPath();
      c.arc(px, py, pr * 0.88, 0, Math.PI * 2);
      c.strokeStyle = color + '22';
      c.lineWidth = 0.5;
      c.stroke();
    }

    // Ownership change highlight
    if (ownerChanged) {
      c.beginPath();
      c.arc(px, py, pr + 3, 0, Math.PI * 2);
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.stroke();
    }

    // --- ADDED: Player Name Label on Planet ---
    if (planet.owner >= 0) {
      const labelFontSize = Math.max(6, scale * 1.0);
      c.font = `bold ${labelFontSize}px 'JetBrains Mono', monospace`;
      c.fillStyle = 'rgba(255, 255, 255, 0.7)';
      c.textAlign = 'center';
      const pName = playerNames[planet.owner] || `P${planet.owner}`;
      c.fillText(pName.toUpperCase(), px, py + pr + labelFontSize);
    }

    // Production dots (small dots around planet)
    if (settings.showProductionDots && planet.owner >= 0 && planet.production > 0) {
      const dotR = Math.max(1, scale * 0.3);
      for (let d = 0; d < planet.production; d++) {
        const dotAngle = (d / planet.production) * Math.PI * 2 - Math.PI / 2;
        const dotDist = pr + dotR + 2;
        const dx = px + Math.cos(dotAngle) * dotDist;
        const dy = py + Math.sin(dotAngle) * dotDist;
        c.beginPath();
        c.arc(dx, dy, dotR, 0, Math.PI * 2);
        c.fillStyle = '#aaa';
        c.fill();
      }
    }
  }

  // Draw fleets as chevrons
  for (const fleet of fleets) {
    const fx = fleet.x * scale;
    const fy = fleet.y * scale;
    const color = getPlayerColor(fleet.owner);
    const sz = (0.4 + (2.0 * Math.log(Math.max(1, fleet.ships))) / Math.log(1000)) * scale;

    c.save();
    c.translate(fx, fy);
    c.rotate(fleet.angle);

    // Standard chevron shape for all players
    c.beginPath();
    c.moveTo(sz, 0);
    c.lineTo(-sz, -sz * 0.6);
    c.lineTo(-sz * 0.3, 0);
    c.lineTo(-sz, sz * 0.6);
    c.closePath();
    c.fillStyle = color;
    c.globalAlpha = 0.85;
    c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = '#222';
    c.lineWidth = 0.5;
    c.stroke();

    // Per-player marking lines for colorblind accessibility
    // P0: none, P1: 1 center line, P2: 2 lines (tip-to-wings), P3: 3 lines
    c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    c.lineWidth = sz * 0.15;
    c.lineCap = 'round';
    if (fleet.owner === 1 || fleet.owner === 3) {
      c.beginPath();
      c.moveTo(sz * 0.8, 0);
      c.lineTo(-sz * 0.2, 0);
      c.stroke();
    }
    if (fleet.owner === 2 || fleet.owner === 3) {
      c.beginPath();
      c.moveTo(sz * 0.6, -sz * 0.15);
      c.lineTo(-sz * 0.7, -sz * 0.45);
      c.stroke();
      c.beginPath();
      c.moveTo(sz * 0.6, sz * 0.15);
      c.lineTo(-sz * 0.7, sz * 0.45);
      c.stroke();
    }

    c.restore();
  }

  // Draw ship counts on planets
  const planetFontSize = Math.max(8, scale * 1.8 * textScale);
  const deltaFontSize = Math.max(6, scale * 1.2 * textScale);
  c.font = `bold ${planetFontSize}px 'JetBrains Mono', monospace`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const planet of planets) {
    const px = planet.x * scale;
    const py = planet.y * scale;
    const shipText = Math.floor(planet.ships).toString();

    c.font = `bold ${planetFontSize}px Inter, sans-serif`;
    c.fillStyle = '#000000';
    c.fillText(shipText, px + 0.5, py + 0.5);
    c.fillStyle = '#ffffff';
    c.fillText(shipText, px, py);

    // Ship count delta (only when production display is on)
    if (settings.showProductionDots) {
      const prev = prevPlanetMap.get(planet.id);
      if (prev) {
        const delta = Math.floor(planet.ships) - Math.floor(prev.ships);
        if (delta !== 0) {
          const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
          c.font = `bold ${deltaFontSize}px Inter, sans-serif`;
          c.fillStyle = delta > 0 ? '#009E73' : '#D55E00';
          c.fillText(deltaText, px, py - planet.radius * scale - deltaFontSize);
        }
      }
    }
  }

  // Fleet ship counts
  if (settings.showFleetNumbers) {
    const fleetFontSize = Math.max(6, scale * 1.2 * textScale);
    c.font = `${fleetFontSize}px 'JetBrains Mono', monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const fleet of fleets) {
      const fx = fleet.x * scale;
      const fy = fleet.y * scale;
      const labelOffset = fleet.y >= 50 ? -scale * 2.5 : scale * 2.5;
      c.fillStyle = getPlayerColor(fleet.owner);
      c.fillText(Math.floor(fleet.ships).toString(), fx, fy + labelOffset);
    }
  }

  // Step indicator
  const stepFontSize = Math.max(8, scale * 1.5 * textScale);
  c.font = `italic ${stepFontSize}px 'JetBrains Mono', monospace`;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillStyle = '#888';
  c.fillText(`Step ${step}`, 6, 6);

  // Game over overlay
  if (isGameOver) {
    const maxScore = Math.max(...playerScores);
    const winners = playerScores.reduce<number[]>((acc, s, i) => {
      if (s === maxScore) acc.push(i);
      return acc;
    }, []);
    const winnerText = winners.length > 1 ? 'Draw!' : `${playerNames[winners[0]]} wins!`;

    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML = `
      <div class="game-over-modal">
        <h2>Game Over</h2>
        <div class="result-text">${winnerText}</div>
        <div style="margin-top: 8px; font-size: 0.85rem; color: #888;">
          ${playerScores.map((s, i) => `${playerNames[i]}: ${s}`).join(' &mdash; ')}
        </div>
      </div>
    `;
    canvasWrapper.appendChild(overlay);
  }
}
