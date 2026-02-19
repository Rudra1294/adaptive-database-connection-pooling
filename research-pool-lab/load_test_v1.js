import http from 'k6/http';
import { check, sleep } from 'k6';

// ---------------------------------------------------------
// CONFIGURATION (The "Attack Plan") 
// ---------------------------------------------------------
export const options = {
  scenarios: {
    adaptive_pool_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // Phase 1: Warm up to baseline
        { duration: '1m',  target: 50 },   // Hold baseline to establish normal Kp
        { duration: '30s', target: 200 },  // Phase 2: Moderate Load (Queue fills)
        { duration: '1m',  target: 200 },  // Hold moderate load
        { duration: '30s', target: 500 },  // Phase 3: High Stress (The Breaking Point)
        { duration: '1m',  target: 500 },  // Hold stress to watch adaptive rejection
        { duration: '30s', target: 0 },    // Cool down gracefully
      ],
    },
  },
  // Thresholds: Fail the test if P95 latency is too high
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should be faster than 2s
  },
};

// ---------------------------------------------------------
// THE USER BEHAVIOR (The Loop)
// ---------------------------------------------------------
export default function () {
  // We roll a dice (0 to 99) to decide what kind of user this is.
  const rand = Math.floor(Math.random() * 100);

  let res;

  if (rand < 80) {
    // 80% chance: MOSQUITO (Fast)
    res = http.get('http://localhost:3000/fast');
    check(res, { 'Mosquito status is 200': (r) => r.status === 200 });
  } 
  else if (rand < 90) {
    // 10% chance: ELEPHANT (Heavy CPU)
    res = http.get('http://localhost:3000/heavy-cpu');
    check(res, { 'Elephant status is 200': (r) => r.status === 200 });
  } 
  else {
    // 10% chance: BLOCKER (Heavy DB/Latency)
    res = http.get('http://localhost:3000/heavy-db');
    check(res, { 'Blocker status is 200': (r) => r.status === 200 });
  }

  // Each user waits 1 second before clicking again
  sleep(1);
}