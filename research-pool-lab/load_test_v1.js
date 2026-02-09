import http from 'k6/http';
import { check, sleep } from 'k6';

// ---------------------------------------------------------
// CONFIGURATION (The "Attack Plan")
// ---------------------------------------------------------
export const options = {
  // We want to simulate a "Ramp Up" of traffic
  stages: [
    { duration: '10s', target: 10 },  // Warm up to 10 users
    { duration: '30s', target: 100 },  // Stay at 100 users (High Load)
    { duration: '10s', target: 0 },   // Cool down
  ],
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