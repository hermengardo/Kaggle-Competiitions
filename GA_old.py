def sim(pop_size=20, n_gens=50, k=3, n_repeats=3, mutate_std=0.1, mutation_rate=0.1, workers=12):
    population = [Agent() for _ in range(pop_size)]
    best_global = None
    max_fit = float("-inf")
    history = {"best": [], "max": [], "mean": [], "gen": []}
    env = make("orbit_wars", debug=True)
    
    with Pool(workers) as pool:
        for gen in tqdm(range(n_gens), desc="Generations"):
            # Gera as chaves
            pairs = []
            quad_pairs = []
            for i in range(pop_size):
                pool_opponents = [j for j in range(pop_size) if j != i]
                pairs += [(i, j, get_params(population[i]), get_params(population[j])) for j in random.sample(pool_opponents, k=k)]
                for _ in range(k):
                    opponents = random.sample(pool_opponents, k=3)
                    indices = [i] + opponents
                    quad_pairs.append((indices, [get_params(population[idx]) for idx in indices]))
                    
            # Jogos
            all_results_1v1 = []
            all_results_ffa = []
            for i in range(n_repeats):
                all_results_1v1.append(pool.map(evaluate_pair, pairs))
                all_results_ffa.append(pool.map(evaluate_quad, quad_pairs))
            
            
            fitnesses_1v1 = np.zeros(pop_size)
            counts_1v1 = np.zeros(pop_size)
            
            for results in all_results_1v1:
                for i, j, fit_i, fit_j in results:
                    fitnesses_1v1[i] += fit_i
                    fitnesses_1v1[j] += fit_j
                    counts_1v1[i] += 1
                    counts_1v1[j] += 1
                    
            fitnesses_1v1 = fitnesses_1v1 / np.maximum(counts_1v1, 1) / n_repeats
    
            fitnesses_ffa = np.zeros(pop_size)
            counts_ffa = np.zeros(pop_size)
            
            for results in all_results_ffa:
                for group_results in results:
                    for original_idx, fit in group_results:
                        fitnesses_ffa[original_idx] += fit
                        counts_ffa[original_idx] += 1
                        
            fitnesses_ffa = fitnesses_ffa / np.maximum(counts_ffa, 1) / n_repeats
    
            fitnesses = fitnesses_1v1
    
            mutate_std *= DECAY
            mutation_rate *= DECAY
            mutation_rate = max(mutate_std, 0.05)
            mutate_std = max(mutation_rate, 0.05)
            
            ranked = sorted(zip(fitnesses, population), key=lambda x: x[0], reverse=True)
            best_fit, best = ranked[0]
            
            if best_fit > max_fit - 300:
                if best_fit > max_fit:
                    max_fit = best_fit
                    best_global = best

                env = make("orbit_wars", debug=True)
                env.run([make_agent_fn(best), "starter"])
                with open(f"replay_agent_gen_{gen + 1}.html", "w", encoding="utf-8") as f:
                    f.write(env.render(mode="html"))
    
            save(best, f"best_agent_gen_{gen + 1}.npy")
            mean_fit = fitnesses.mean()
            tqdm.write(f"Gen {gen+1:3d} | best={best_fit:.1f} | mean={mean_fit:.1f} | max={max_fit:.1f} | std={mutate_std:.2f} | mutation rate={mutation_rate:.2f}")
            
            elite = [agent for _, agent in ranked[:4]]
            new_population = list(elite)
            while len(new_population) < pop_size:
                father, father_fit = tournament(population, fitnesses)
                mother, mother_fit = tournament(population, fitnesses)
                child = crossover(father, mother)
                
                if random.random() < mutation_rate:
                    mutate(child, std=mutate_std)
                
                new_population.append(child)


    save(best_global, "best_agent.npy")
    save(best, "last.npy")
    
    return history