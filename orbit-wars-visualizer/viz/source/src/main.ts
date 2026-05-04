
/// <reference types="vite/client" />
import { ReplayAdapter } from '../core/src/index';
import renderer from './renderer';
import './style.css';

const ORBIT_WARS_STEP_DURATION = 550;
const getOrbitWarsStepRenderTime = (step: any, mode: any, speed: number) => ORBIT_WARS_STEP_DURATION * (1 / speed);

interface Episode {
  name: string;
  file: string;
}

function getAppElement(targetId?: string): HTMLElement | null {
    // If a specific App ID is provided (e.g. from Python notebook render), use that.
    // Otherwise fall back to the global #orbit-wars-app.
    const appId = targetId || (window as any).orbitWarsAppId || 'orbit-wars-app';
    return document.getElementById(appId);
}

// episodeListElement is optional for standalone mode
const episodeListElement = document.getElementById('episode-list');

async function fetchAndLoadReplay(fileUrl: string, fileName: string) {
  console.log(`Loading replay from: ${fileUrl}`);
  const appElement = getAppElement();
  if (!appElement) {
      console.warn("fetchAndLoadReplay: appElement not found.");
      return;
  }
  appElement.innerHTML = '<div class="loading">Loading replay data...</div>';
  
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const replayData = await response.json();
    console.log('Replay data loaded successfully:', replayData.steps?.length, 'steps');
    
    mountReplayData(replayData, undefined, fileName);
  } catch (error) {
    console.error('Failed to load replay:', error);
    appElement!.innerHTML = `<div class="error" style="color: red; padding: 20px;">Failed to load replay: ${error}</div>`;
  }
}

export function mountReplayData(replayData: any, targetId?: string, fileName: string = 'standalone.json') {
    const appElement = getAppElement(targetId);
    if (!appElement) {
        console.warn(`App element ${targetId || 'default'} not found, retrying in 100ms...`);
        setTimeout(() => mountReplayData(replayData, targetId, fileName), 100);
        return;
    }
    
    // Inject names into info if they aren't there
    if (!replayData.info) replayData.info = {};
    if (!replayData.info.TeamNames) {
        // Try to extract from filename: agent1_vs_agent2.json or agent1_agent2.json
        const cleanName = fileName.replace('.json', '');
        let parts = cleanName.split('_vs_');
        if (parts.length < 2) parts = cleanName.split('_v_');
        if (parts.length < 2 && cleanName.includes(' vs ')) parts = cleanName.split(' vs ');
        
        if (parts.length >= 2) {
            replayData.info.TeamNames = [parts[0], parts[1].split('_')[0]];
        } else {
            // HEURISTIC DETECTION
            const guessedNames = ['Player 1', 'Player 2'];
            
            // If mission_history exists, Player 0 is almost certainly the RL Mission agent
            if (replayData.mission_history) {
                guessedNames[0] = 'RL Mission Agent';
            }
            
            // If filename has 1224, it's likely the Orbit Star Wars LB 1224 agent
            if (fileName.includes('1224')) {
                if (guessedNames[0] === 'RL Mission Agent') guessedNames[1] = 'OrbitStarWars-1224';
                else guessedNames[0] = 'OrbitStarWars-1224';
            }

            replayData.info.TeamNames = guessedNames;
        }
    }

    const teamNames = replayData.info?.TeamNames || ['Player 1', 'Player 2'];
    const agents = teamNames.map((name: string, i: number) => ({
        index: i,
        name: name,
    }));

    // Use a unique container to bypass Factory reuse/HMR logic which might be stalling
    const containerId = `viz-container-${Math.random().toString(36).substr(2, 9)}`;
    appElement!.innerHTML = `<div id="${containerId}" style="width: 100%; height: 100%;"></div>`;
    const vizContainer = appElement!.firstElementChild as HTMLElement;

    console.log('Initializing adapter...');
    const adapter = new ReplayAdapter({
        gameName: 'orbit_wars',
        renderer: (options: any) => {
            return renderer(options);
        },
        ui: 'inline',
        getStepRenderTime: (step: any, mode: any, speed: number) => getOrbitWarsStepRenderTime(step, mode, speed),
    });

    console.log('Mounting adapter to DOM...');
    adapter.mount(vizContainer, replayData);
    
    // Pass agents info to the React header via render call
    adapter.render(0, replayData, agents);
    
    console.log('Visualizer mounted and names synced');
}

// Global export for dynamic mounting
(window as any).mountOrbitWarsVisualizer = (replayData: any, targetId?: string, fileName: string = 'standalone.json') => {
    try {
        mountReplayData(replayData, targetId, fileName);
    } catch (e) {
        console.error("Error mounting visualizer:", e);
    }
};

async function initBrowser() {
  try {
    console.log('Loading replays via import.meta.glob');
    // Eagerly load the URLs of all json files in the replays directory
    const replayFiles = import.meta.glob('../../replays/*.json', { query: '?url', eager: true, import: 'default' }) as Record<string, string>;
    
    // Fallback if the glob is empty or doesn't match the actual path
    let files = Object.keys(replayFiles);
    if (files.length === 0) {
      // Try local replays folder
      const localReplays = import.meta.glob('../replays/*.json', { query: '?url', eager: true, import: 'default' }) as Record<string, string>;
      files = Object.keys(localReplays);
      Object.assign(replayFiles, localReplays);
    }
    
    console.log('Episodes loaded:', files.length);
    
    if (episodeListElement) {
        episodeListElement.innerHTML = ''; 

        if (files.length === 0) {
            episodeListElement.innerHTML = '<li>No replays found</li>';
            return;
        }
    } else {
        return; // Not in browser mode
    }

    // Sort files by name (or path)
    files.sort().forEach((file, index) => {
      const fileName = file.split('/').pop()!;
      if (fileName === 'manifest.json') return; // Ignore manifest if it still exists
      
      const epName = fileName.replace('.json', '').replace(/_/g, ' ');
      
      if (episodeListElement) {
          const li = document.createElement('li');
          li.textContent = epName;
          li.dataset.file = fileName;
          
          li.addEventListener('click', () => {
            document.querySelectorAll('#episode-list li').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            fetchAndLoadReplay(replayFiles[file], fileName);
          });
          
          episodeListElement.appendChild(li);
          
          if (index === 0) {
            li.classList.add('active');
            fetchAndLoadReplay(replayFiles[file], fileName);
          }
      }
    });
  } catch (error) {
    console.error('Failed to load replays:', error);
    if (episodeListElement) {
        episodeListElement.innerHTML = `<li style="color: #ff4a4a">Error: ${error}</li>`;
    }
  }
}

// Check for browser mode vs standalone
try {
    const isBrowserMode = !!episodeListElement;
    if (isBrowserMode) {
        initBrowser();
    }
} catch (e) {
    console.warn("Visualizer initialization skipped or failed:", e);
}

if (import.meta.env?.DEV && import.meta.hot) {
  import.meta.hot.accept();
}
