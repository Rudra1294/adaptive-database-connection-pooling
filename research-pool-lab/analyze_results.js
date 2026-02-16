// import fs from 'fs';

// // Get file name from command line
// const fileName = process.argv[2];

// if (!fileName) {
//     console.error("❌ Error: Please provide a file name.");
//     console.error("Usage: node analyze_results.js results_static.csv");
//     process.exit(1);
// }

// try {
//     const data = fs.readFileSync(fileName, 'utf8');
//     const lines = data.trim().split('\n');
//     lines.shift(); // Remove Header row

//     let maxLag = 0;
//     let minLag = Infinity;
    
//     // Stats for "Stress Period" (When server was actually busy)
//     let stressTotalLag = 0;
//     let stressCount = 0;

//     // Stats for "Overall" (Includes idle 0ms)
//     let allTotalLag = 0;
//     let allCount = 0;

//     lines.forEach(line => {
//         const columns = line.split(',');
        
//         // CSV Format: Timestamp, ActiveRequests, Lag_ms, VirtualLimit, Status
//         // So Lag is index 2, ActiveRequests is index 1
//         const activeReq = parseInt(columns[1]);
//         const lag = parseFloat(columns[2]);

//         if (!isNaN(lag)) {
//             // 1. Always track Max/Min across the WHOLE test
//             if (lag > maxLag) maxLag = lag;
//             if (lag < minLag) minLag = lag;

//             // 2. Track Overall Totals
//             allTotalLag += lag;
//             allCount++;

//             // 3. Track STRESS Totals (Filter out idle times)
//             // We count it if there are active users OR if there is actual lag (> 5ms)
//             // This prevents "0ms" idle rows from dragging down your average.
//             if (activeReq > 0 || lag > 5) {
//                 stressTotalLag += lag;
//                 stressCount++;
//             }
//         }
//     });

//     const avgLagOverall = allCount > 0 ? (allTotalLag / allCount).toFixed(2) : 0;
//     const avgLagStress = stressCount > 0 ? (stressTotalLag / stressCount).toFixed(2) : 0;

//     console.log(`\n📊 ANALYSIS REPORT FOR: ${fileName}`);
//     console.log(`========================================`);
//     console.log(`🔹 Total Data Points:  ${allCount}`);
//     console.log(`🟢 Minimum Lag:        ${minLag} ms`);
//     console.log(`🔴 Maximum Lag:        ${maxLag} ms`);
//     console.log(`----------------------------------------`);
//     console.log(`📉 Average (Overall):  ${avgLagOverall} ms`);
//     console.log(`🔥 Average (Under Load): ${avgLagStress} ms`);
//     console.log(`========================================\n`);a

// } catch (err) {
//     console.error(`❌ Could not read file: ${fileName}`);
//     console.error(err.message);
// }




import fs from 'fs';

const fileName = process.argv[2];

if (!fileName) {
    console.error("❌ Error: Please provide a file name.");
    process.exit(1);
}

try {
    const data = fs.readFileSync(fileName, 'utf8');
    const lines = data.trim().split('\n');
    lines.shift(); // Remove Header row

    let stressLags = []; // Store lags to calculate percentiles
    let stressCount = 0;
    
    let minVirtualLimit = Infinity;
    let saturatedCount = 0;

    lines.forEach(line => {
        const columns = line.split(',');
        if (columns.length < 5) return; // Skip malformed lines
        
        // CSV Format: Timestamp, ActiveRequests, Lag_ms, VirtualLimit, Status, Kp_Used
        const activeReq = parseInt(columns[1]);
        const lag = parseFloat(columns[2]);
        const virtualLimit = parseInt(columns[3]);
        const status = columns[4];

        if (!isNaN(lag)) {
            // Track the lowest the pool ever dropped
            if (virtualLimit < minVirtualLimit) minVirtualLimit = virtualLimit;

            // Track how often the controller shed load
            if (status === 'SATURATED') saturatedCount++;

            // Define "Under Load" rigorously (Active users OR actual lag)
            if (activeReq > 0 || lag > 5) {
                stressLags.push(lag);
                stressCount++;
            }
        }
    });

    // Sort the array to calculate accurate Percentiles
    stressLags.sort((a, b) => a - b);

    // Math for Averages and Percentiles
    const stressTotalLag = stressLags.reduce((sum, val) => sum + val, 0);
    const avgLagStress = stressCount > 0 ? (stressTotalLag / stressCount).toFixed(2) : 0;
    
    // Percentile Calculation
    const getPercentile = (percentile) => {
        if (stressLags.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * stressLags.length) - 1;
        return stressLags[index].toFixed(2);
    };

    const p50 = getPercentile(50); // Median
    const p95 = getPercentile(95);
    const p99 = getPercentile(99);
    const maxLag = stressLags.length > 0 ? stressLags[stressLags.length - 1].toFixed(2) : 0;

    console.log(`\n📊 ACADEMIC ANALYSIS REPORT: ${fileName}`);
    console.log(`====================================================`);
    console.log(`🔹 Total Data Points (Under Load): ${stressCount}`);
    console.log(`🛡️  Times Controller Shed Load (SATURATED): ${saturatedCount}`);
    console.log(`📉 Lowest Virtual Pool Limit Reached: ${minVirtualLimit === Infinity ? 'N/A' : minVirtualLimit}`);
    console.log(`----------------------------------------------------`);
    console.log(`⏱️  LATENCY METRICS (Under Load)`);
    console.log(`   Average (Mean) Lag: ${avgLagStress} ms (Ignore this for paper)`);
    console.log(`   Median (P50) Lag:   ${p50} ms`);
    console.log(`   P95 Latency:        ${p95} ms (Use this for paper)`);
    console.log(`   P99 Latency:        ${p99} ms (Use this for paper)`);
    console.log(`   Maximum Peak Lag:   ${maxLag} ms`);
    console.log(`====================================================\n`);

} catch (err) {
    console.error(`❌ Could not read file: ${fileName}`);
    console.error(err.message);
}