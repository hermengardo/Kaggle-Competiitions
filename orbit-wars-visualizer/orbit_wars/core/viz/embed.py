import json
import base64
from pathlib import Path

def render(env_or_json):
    """
    Renders an Orbit Wars replay using the bundled visualizer.
    This works similarly to kaggle_environments env.render(mode='ipython').
    
    Args:
        env_or_json: Either a kaggle_environments.Environment instance, 
                     or a dictionary representing the JSON replay.
    """
    from IPython.display import HTML, display
    import uuid
    
    if isinstance(env_or_json, dict):
        replay_data = env_or_json
    else:
        # Assume it's an Environment object
        replay_data = env_or_json.toJSON()
        
    viz_dir = Path(__file__).parent.parent.parent.parent / "viz"
    dist_dir = viz_dir / "dist"
    assets_dir = dist_dir / "assets"
    
    if not dist_dir.exists():
        display(HTML("<div style='color:red'>Visualizer not built. Please run 'npm run build' in the 'viz' directory.</div>"))
        return
        
    # Find built JS and CSS
    js_files = list(assets_dir.glob("index-*.js"))
    css_files = list(assets_dir.glob("index-*.css"))
    
    if not js_files or not css_files:
        display(HTML("<div style='color:red'>Visualizer assets not found.</div>"))
        return
        
    js_content = js_files[0].read_text(encoding="utf-8")
    css_content = css_files[0].read_text(encoding="utf-8")
    
    # Base64 encode assets to safely embed them without worrying about quotes/backticks
    js_b64 = base64.b64encode(js_content.encode('utf-8')).decode('utf-8')
    css_b64 = base64.b64encode(css_content.encode('utf-8')).decode('utf-8')
    
    replay_json_str = json.dumps(replay_data)
    app_id = f"orbit-wars-viz-{uuid.uuid4().hex[:8]}"
    
    html_template = f"""
    <div id="orbit-wars-viz-wrapper-{app_id}" class="orbit-wars-viz-wrapper" 
         style="width: 100%; height: 800px; border: 1px solid #333; overflow: hidden; background: #050510; position: relative; margin: 10px 0;">
        <div id="{app_id}" style="width: 100%; height: 100%;"></div>
        
        <script>
            (function() {{
                const APP_ID = "{app_id}";
                const REPLAY_DATA = {replay_json_str};
                
                window._mountOrbitWars = window._mountOrbitWars || ((appId, data, jsB64, cssB64) => {{
                    const decode = (b64) => decodeURIComponent(escape(window.atob(b64)));
                    
                    if (!window._orbitWarsAssetsInjected) {{
                        const style = document.createElement('style');
                        style.textContent = decode(cssB64) + `
                            .orbit-wars-viz-wrapper .sidebar {{ display: none !important; }}
                            .orbit-wars-viz-wrapper .renderer-container {{ padding-bottom: 50px !important; }}
                        `;
                        document.head.appendChild(style);
                        
                        const script = document.createElement('script');
                        script.type = 'module';
                        script.textContent = decode(jsB64);
                        document.head.appendChild(script);
                        window._orbitWarsAssetsInjected = true;
                    }}

                    const tryMount = () => {{
                        if (window.mountOrbitWarsVisualizer) {{
                            window.mountOrbitWarsVisualizer(data, appId);
                        }} else {{
                            setTimeout(tryMount, 50);
                        }}
                    }};
                    tryMount();
                }});

                window._mountOrbitWars(APP_ID, REPLAY_DATA, "{js_b64}", "{css_b64}");
            }})();
        </script>
    </div>
    """
    
    display(HTML(html_template))
