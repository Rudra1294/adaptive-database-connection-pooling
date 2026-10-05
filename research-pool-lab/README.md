# Adaptive Database Connection Pooling

## 📌 Project Overview
This research project implements an adaptive, self-tuning database connection pool and request queueing system for Node.js and MongoDB. Designed to handle severe traffic spikes and mixed workloads, the architecture dynamically resizes the database connection pool based on real-time event-loop lag. By combining gain-scheduling control logic, priority queueing, and defensive networking, the system protects the database from saturation while drastically reducing latency for standard users.

## 🏗️ Architecture & Evolution
The project is structured as a series of evolutionary phases, demonstrating the progression from a standard static pool to a highly optimized hybrid controller:
* **Phase 1 (Baseline):** Standard static connection pool (`maxPoolSize: 20`) with basic retry logic.
* **Phase 2 (Stress):** Introduction of mixed simulated workloads (Fast Reads, Heavy CPU, Heavy DB) to expose event-loop blocking.
* **Phase 3 (Monitor):** Integration of a hybrid monitoring system using `perf_hooks` (Event Loop Delay) with a Wall-Clock backup.
* **Phase 4 (Adaptive):** Implementation of a Dynamic Proportional Controller (Gain Scheduling) that shrinks the pool under lag and grows it safely.
* **Phase 5 & 6 (Hybrid & FIFO):** Introduction of an advanced Dispatcher using either strict FIFO or a Smart Priority Queue with Request Aging, Zombie Pruning, and buffering.

## ⚙️ Core Mechanisms

### 1. Dynamic Gain Scheduling (Adaptive Pool Limits)
Instead of static connection limits, the server calculates the difference between current lag and a `TARGET_LAG` (25ms). If the lag spikes, a proportional controller (`Kp`) applies brakes aggressively (e.g., dropping limits rapidly if lag > 500ms) or nudges gently (lag < 100ms) to prevent system collapse.

### 2. Smart Priority Queueing with Request Aging
Requests are scored and sorted before hitting the database:
* **VIP Triage:** Fast requests ("Mosquitoes", Priority 3) skip ahead of heavy analytics ("Blockers", Priority 1).
* **Aging Math:** To prevent starvation, waiting queries increase in priority over time (`AGING_RATE_PER_SEC`). A slow query reaches VIP priority after a few seconds of waiting.

### 3. Defensive Networking & Zombie Pruning
* **Instant Load Shedding:** If the internal queue breaches `MAX_QUEUE_SIZE` (500), the system instantly returns `503 System Overload` without tying up resources.
* **Zombie Pruning:** The dispatcher checks `req.destroyed` or `isAborted` before executing a query. If a user closes their browser or times out while waiting in the queue, the request is silently dropped rather than executed against the database.
* **Strict Timeouts:** Requests sitting in the queue longer than `MAX_REQUEST_AGE` (5000ms) are aborted.

## 🧪 Workload Simulation
The system is tested using a `k6` ramping virtual user script (`load_test_v1.js`) peaking at 500 VUs. It simulates three user archetypes to create a chaotic, realistic load:
1. **Mosquito (80%):** Fast, lightweight MongoDB reads (`/fast`).
2. **Elephant (10%):** CPU-intensive cryptographic hashing (`/heavy-cpu`).
3. **Blocker (10%):** Heavy, slow-resolving database transactions (`/heavy-db`).

## 📊 Performance Benchmarks
Under a sustained stress test peaking at 500 concurrent virtual users (capped at 8 CPUs for Node, 1 CPU for MongoDB), the adaptive architectures demonstrated significant latency improvements:

| Architecture Strategy | Median (P50) Latency | P95 Latency | Max Latency | System Status |
| :--- | :--- | :--- | :--- | :--- |
| **V1: Static Pool (Baseline)** | 20.34 ms | 593.78 ms | 8201.96 ms | Cascading Failure |
| **V4: Adaptive Pool** | 20.48 ms | 104.03 ms | 272.76 ms | Stable |
| **V5: Hybrid Priority Queue** | **14.00 ms** | 379.00 ms | 476.00 ms | Highly Responsive |

*Note: The Hybrid Priority Queue sacrifices a small amount of P95 latency on heavy blockers to aggressively prioritize the P50 median user, ensuring 80% of standard users (Mosquitoes) experience zero degradation during a spike.*

## 🚀 Getting Started

### Prerequisites
* [Docker](https://www.docker.com/) and Docker Compose
* [Node.js](https://nodejs.org/) (v18+)
* [k6](https://k6.io/) (for load testing)

### Installation
1. Clone the repository and navigate to the project folder.
2. Build and start the containerized environment:
   ```bash
   docker-compose up --build

### Running the Load Test & Analysis

Once a server phase is running, you can trigger the attack plan and analyze the results sequentially. 

```bash
# 1. Trigger the load test using k6
k6 run load_test_v1.js

# 2. Generate an academic report of the event-loop logs
node analyze_results.js results_ultimate.csv