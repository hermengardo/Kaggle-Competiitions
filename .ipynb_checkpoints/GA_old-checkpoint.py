from kaggle_environments import make
from kaggle_environments.envs.orbit_wars.orbit_wars import Planet, Fleet
import math
import numpy as np
import random
import gc
from tqdm import tqdm
from multiprocessing import Pool

BOARD = 100.0
CENTER_X = 50.0
CENTER_Y = 50.0
SUN_R = 10.0
MAX_SPEED = 6.0
SUN_SAFETY = 1.5
ROTATION_LIMIT = 50.0
TOTAL_STEPS = 500
HORIZON = 180
LAUNCH_CLEARANCE = 0.1
SAFE_NEUTRAL_MARGIN = 2
CONTESTED_NEUTRAL_MARGIN = 2
INTERCEPT_TOLERANCE = 1
AIM_ITERATIONS = 8
WAIT_STRIKE_DELAYS = (0, 2, 4, 6)
WAIT_STRIKE_ENABLED = True
WAIT_STRIKE_MAX_TARGETS = 6
CANDIDATE_FEATURES = 11
MIN_SHIPS = 20

class Config:
    ID, OWNER, X, Y, RADIUS, SHIPS, PROD = 0, 1, 2, 3, 4, 5, 6
    SUN_X, SUN_Y, SUN_R = 50, 50, 10
    max_planets = 44
    HIDDEN = 32
    N_WEIGHTS = CANDIDATE_FEATURES * HIDDEN + HIDDEN + HIDDEN + 1

CFG = Config()

def candidate_features(src, dst, frac, ships_sent, travel_time, total_planets, owned_count, player):
    return np.array([
        frac,
        owned_count / total_planets,
        math.log1p(src.ships) / math.log1p(1000),
        math.log1p(dst.ships) / math.log1p(1000),
        math.log1p(dst.production) / math.log1p(10),
        dist(src.x, src.y, dst.x, dst.y) / 100.0,
        travel_time / 500.0,
        float(dst.owner != player and dst.owner != -1),
        float(dst.owner == -1),
        float(dst.owner == player),
        dst.production / max(dst.ships + 1, 1),
    ], dtype=np.float32)


def dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)


def orbital_radius(planet):
    return dist(planet.x, planet.y, CENTER_X, CENTER_Y)


def is_static_planet(planet):
    return orbital_radius(planet) + planet.radius >= ROTATION_LIMIT


def fleet_speed(ships):
    if ships <= 1:
        return 1.0
    ratio = math.log(ships) / math.log(1000.0)
    ratio = max(0.0, min(1.0, ratio))
    return 1.0 + (MAX_SPEED - 1.0) * (ratio ** 1.5)


def point_to_segment_distance(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq <= 1e-9:
        return dist(px, py, x1, y1)
    t = ((px - x1) * dx + (py - y1) * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy
    return dist(px, py, proj_x, proj_y)

def segment_hits_sun(x1, y1, x2, y2, safety=SUN_SAFETY):
    return point_to_segment_distance(CENTER_X, CENTER_Y, x1, y1, x2, y2) < SUN_R + safety


def launch_point(sx, sy, sr, angle):
    clearance = sr + LAUNCH_CLEARANCE
    return sx + math.cos(angle) * clearance, sy + math.sin(angle) * clearance


def actual_path_geometry(sx, sy, sr, tx, ty, tr):
    angle = math.atan2(ty - sy, tx - sx)
    start_x, start_y = launch_point(sx, sy, sr, angle)
    hit_distance = max(0.0, dist(sx, sy, tx, ty) - (sr + LAUNCH_CLEARANCE) - tr)
    end_x = start_x + math.cos(angle) * hit_distance
    end_y = start_y + math.sin(angle) * hit_distance
    return angle, start_x, start_y, end_x, end_y, hit_distance


def safe_angle_and_distance(sx, sy, sr, tx, ty, tr):
    angle, start_x, start_y, end_x, end_y, hit_distance = actual_path_geometry(
        sx, sy, sr, tx, ty, tr,
    )
    if segment_hits_sun(start_x, start_y, end_x, end_y):
        return None
    return angle, hit_distance

def predict_planet_position(planet, initial_by_id, angular_velocity, turns):
    init = initial_by_id.get(planet.id)
    if init is None:
        return planet.x, planet.y
    r = dist(init[2], init[3], CENTER_X, CENTER_Y)
    if r + init[4] >= ROTATION_LIMIT:
        return planet.x, planet.y
    cur_ang = math.atan2(planet.y - CENTER_Y, planet.x - CENTER_X)
    new_ang = cur_ang + angular_velocity * turns
    return (
        CENTER_X + r * math.cos(new_ang),
        CENTER_Y + r * math.sin(new_ang),
    )

# In[5]:
class Agent:
    def __init__(self, hidden=CFG.HIDDEN):
        self.hidden = hidden
        self.w = np.random.randn(CANDIDATE_FEATURES * hidden + hidden + hidden + 1).astype(np.float32) * 0.1

    def _unpack(self):
        h = self.hidden
        idx = 0
        W1 = self.w[idx:idx + CANDIDATE_FEATURES * h].reshape(CANDIDATE_FEATURES, h); idx += CANDIDATE_FEATURES * h
        b1 = self.w[idx:idx + h]; idx += h
        W2 = self.w[idx:idx + h].reshape(h, 1); idx += h
        b2 = self.w[idx:idx + 1]; idx += 1
        return W1, b1, W2, b2

    def act(self, obs):
        player = obs.get("player", 0)
        planets = [Planet(*p) for p in obs.get("planets", [])]
        angular_vel = obs.get("angular_velocity", 0)
        initial_planets = obs.get("initial_planets", [])
        initial_by_id = {p[0]: p for p in initial_planets}

        owned = [p for p in planets if p.owner == player and p.ships > MIN_SHIPS]
        if not owned:
            return []

        owned_count = len(owned)
        total_planets = len(planets)
        fracs = np.array([0, 0.25, 0.75, 1])
        W1, b1, W2, b2 = self._unpack()

        candidates = []
        feat_matrix = []
        
        for src in owned:
            for dst in planets:
                if dst.id == src.id:
                    continue
                for frac in fracs:
                    ships_sent = max(0, int(frac * src.ships))
                    speed = fleet_speed(ships_sent)
                    travel_time = dist(src.x, src.y, dst.x, dst.y) / speed

                    if is_static_planet(dst):
                        dx, dy = dst.x, dst.y
                        travel_time = dist(src.x, src.y, dx, dy) / speed
                    else:
                        dx, dy = dst.x, dst.y
                        for _ in range(AIM_ITERATIONS):
                            travel_time = dist(src.x, src.y, dx, dy) / speed
                            dx, dy = predict_planet_position(dst, initial_by_id, angular_vel, travel_time)
                    
                    safe = safe_angle_and_distance(src.x, src.y, src.radius, dx, dy, dst.radius)
                    if safe is None:
                        continue
                    
                    angle = safe[0]
                    
                    feats = candidate_features(src, dst, frac, ships_sent, travel_time, total_planets, owned_count, player)
                    candidates.append((src.id, angle, ships_sent))
                    feat_matrix.append(feats)

        if not candidates:
            return []

        X = np.stack(feat_matrix)
        H = np.tanh(X @ W1 + b1)
        scores = (H @ W2 + b2).squeeze()

        scores -= scores.max()
        probs = np.exp(scores) / np.exp(scores).sum()
        order = np.argsort(probs)[::-1]

        actions = []
        used_sources = set()
        cumulative = 0.0
        for idx in order:
            src_id, angle, ships = candidates[idx]
            if src_id in used_sources:
                continue
            actions.append([src_id, angle, ships])
            used_sources.add(src_id)
            cumulative += probs[idx]
            if cumulative > 0.1:
                break
                    
        return actions

def get_params(agent):
    return agent.w.copy()

def set_params(agent, params):
    agent.w = params.astype(np.float32)

def crossover(father, mother):
    gf, gm = get_params(father), get_params(mother)
    mask = np.random.rand(len(gf)) > 0.5
    child = Agent()
    set_params(child, np.where(mask, gf, gm))
    return child

def mutate(agent, std=0.02):
    params = get_params(agent)
    params += np.random.randn(len(params)).astype(np.float32) * std
    set_params(agent, params)

def save(agent, path):
    np.save(path, get_params(agent))

def load(agent, path):
    set_params(agent, np.load(path))


# In[8]:
def compute_fitness(state, idx, agent):
    reward = state[idx].reward or 0
    obs = state[idx].observation
    planets = [Planet(*p) for p in obs.planets]
    owned = [p for p in planets if p.owner == obs.player]
    step = state[0].observation.step

    total_ships = sum(p.ships for p in planets)
    owned_ships = sum(p.ships for p in owned)
    ship_ratio = owned_ships / max(total_ships, 1)

    speed = (500 - step) / 500
    domination = len(owned) / len(planets)
    total_production = sum(p.production for p in owned)
    max_possible_production = sum(p.production for p in planets)
    prod_ratio = total_production / max(max_possible_production, 1)

    return reward * 100 + domination * 50 + prod_ratio * 30 + speed * 30 + ship_ratio * 5

def tournament(population, fitnesses, k=3):
    contestants = random.sample(list(zip(fitnesses, population)), k)
    winner = max(contestants, key=lambda x: x[0])
    return winner[1], winner[0]


def make_agent_fn(model):
    def fn(obs, config=None):
        return model.act(obs)
    return fn


def evaluate_pair(args):
    i, j, params_i, params_j = args
    env = make("orbit_wars", debug=True)

    agent_i = Agent()
    agent_j = Agent()
    set_params(agent_i, params_i)
    set_params(agent_j, params_j)

    fn_i = make_agent_fn(agent_i)
    fn_j = make_agent_fn(agent_j)

    players = [(fn_i, i), (fn_j, j)]
    random.shuffle(players)
    env.reset()
    env.run([p[0] for p in players])

    idx_i = [p[1] for p in players].index(i)
    idx_j = [p[1] for p in players].index(j)

    fit_i = compute_fitness(env.state, idx_i, agent_i)
    fit_j = compute_fitness(env.state, idx_j, agent_j)

    return i, j, fit_i, fit_j

def evaluate_quad(args):
    indices, params_list = args
    env = make("orbit_wars", debug=True)

    agents = [Agent() for _ in range(4)]
    for agent, params in zip(agents, params_list):
        set_params(agent, params)

    players = list(zip([make_agent_fn(a) for a in agents], indices))
    random.shuffle(players)
    env.reset()
    env.run([p[0] for p in players])

    results = []
    for shuffled_idx, (_, original_idx) in enumerate(players):
        original_idx_in_agents = indices.index(original_idx)
        fit = compute_fitness(env.state, shuffled_idx, agents[original_idx_in_agents])
        results.append((original_idx, fit))

    return results

def load_partial_structured(agent, path, old_features, old_hidden):
    old_w = np.load(path)
    h = agent.hidden

    idx = 0
    old_W1 = old_w[idx:idx + old_features * old_hidden].reshape(old_features, old_hidden); idx += old_features * old_hidden
    old_b1 = old_w[idx:idx + old_hidden]; idx += old_hidden
    old_W2 = old_w[idx:idx + old_hidden].reshape(old_hidden, 1); idx += old_hidden
    old_b2 = old_w[idx:idx + 1]

    new_W1 = np.random.randn(CANDIDATE_FEATURES, h).astype(np.float32) * 0.1
    new_W1[:old_features, :old_hidden] = old_W1

    new_b1 = np.random.randn(h).astype(np.float32) * 0.1
    new_b1[:old_hidden] = old_b1

    new_W2 = np.random.randn(h, 1).astype(np.float32) * 0.1
    new_W2[:old_hidden] = old_W2

    new_b2 = old_b2.copy()

    new_w = np.concatenate([new_W1.flatten(), new_b1, new_W2.flatten(), new_b2])
    set_params(agent, new_w)

def sim(pop_size=20, n_gens=50, k=3, mutate_std=0.1, weights_path=None, old_features=None, old_hidden=None):
    if weights_path is None:
        population = [Agent() for _ in range(pop_size)]
    else:
        population = []
        for _ in range(pop_size):
            agent = Agent()
            load_partial_structured(agent, weights_path, old_features=old_features, old_hidden=old_hidden)
            mutate(agent, std=mutate_std)
            population.append(agent)
        
    best_global = None
    max_fit = float("-inf")
    history = {"best": [], "max": [], "mean": [], "gen": []}
    env = make("orbit_wars", debug=True)
    
    for gen in tqdm(range(n_gens), desc="Generations"):
        pairs = []
        for i in range(pop_size):
            opponents = random.sample([j for j in range(pop_size) if j != i], k=k)
            for j in opponents:
                pairs.append((i, j, get_params(population[i]), get_params(population[j])))

        with Pool(processes=16) as pool:
            results = pool.map(evaluate_pair, pairs)

        fitnesses_1v1 = np.zeros(pop_size)
        counts_1v1 = np.zeros(pop_size)
        for i, j, fit_i, fit_j in results:
            fitnesses_1v1[i] += fit_i
            fitnesses_1v1[j] += fit_j
            counts_1v1[i] += 1
            counts_1v1[j] += 1
        fitnesses_1v1 = fitnesses_1v1 / np.maximum(counts_1v1, 1)

        quad_pairs = []
        indices_pool = list(range(pop_size))
        random.shuffle(indices_pool)
        for i in range(0, pop_size - 3, 4):
            group = indices_pool[i:i+4]
            quad_pairs.append((group, [get_params(population[j]) for j in group]))

        with Pool(processes=16) as pool:
            quad_results = pool.map(evaluate_quad, quad_pairs)

        fitnesses_ffa = np.zeros(pop_size)
        counts_ffa = np.zeros(pop_size)
        for group_results in quad_results:
            for original_idx, fit in group_results:
                fitnesses_ffa[original_idx] += fit
                counts_ffa[original_idx] += 1
        fitnesses_ffa = fitnesses_ffa / np.maximum(counts_ffa, 1)

        fitnesses = 0.5 * fitnesses_1v1 + 0.5 * fitnesses_ffa
        mutate_std *= 0.9995
        mutate_std = max(mutate_std, 0.05)

        ranked = sorted(zip(fitnesses, population), key=lambda x: x[0], reverse=True)
        best_fit, best = ranked[0]

        if best_fit > max_fit - 30:
            if best_fit > max_fit:
                max_fit = best_fit
                best_global = best
        
            env.reset()
            env.run([make_agent_fn(best), "starter"])
            with open(f"replay_agent_gen_{gen + 1}.html", "w", encoding="utf-8") as f:
                f.write(env.render(mode="html"))

        save(best, f"best_agent_gen_{gen + 1}.npy")

        mean_fit = fitnesses.mean()
        tqdm.write(f"Gen {gen+1:3d} | best={best_fit:.1f} | mean={mean_fit:.1f} | max={max_fit:.1f} | std={mutate_std:.4f}")

        elite = [agent for _, agent in ranked[:2]]
        new_population = list(elite)
        while len(new_population) < pop_size:
            father, father_fit = tournament(population, fitnesses)
            mother, mother_fit = tournament(population, fitnesses)
            child = crossover(father, mother)
            mutate(child, std=mutate_std)
            new_population.append(child)

        population = new_population
        gc.collect()

        history["best"].append(best_fit)
        history["max"].append(max_fit)
        history["mean"].append(mean_fit)
        history["gen"].append(gen + 1)

    save(best_global, "best_agent.npy")
    save(best, "last.npy")
    return history

history = sim(pop_size=8, n_gens=10000, k=2, mutate_std=0.9, weights_path=None)
