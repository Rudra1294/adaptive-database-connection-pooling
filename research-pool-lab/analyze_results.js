import fs from 'fs';

// Get file name from command line
const fileName = process.argv[2];

if (!fileName) {
    console.error("❌ Error: Please provide a file name.");
    console.error("Usage: node analyze_results.js results_static.csv");
    process.exit(1);
}

try {
    const data = fs.readFileSync(fileName, 'utf8');
    const lines = data.trim().split('\n');
    lines.shift(); // Remove Header row

    let maxLag = 0;
    let minLag = Infinity;
    
    // Stats for "Stress Period" (When server was actually busy)
    let stressTotalLag = 0;
    let stressCount = 0;

    // Stats for "Overall" (Includes idle 0ms)
    let allTotalLag = 0;
    let allCount = 0;

    lines.forEach(line => {
        const columns = line.split(',');
        
        // CSV Format: Timestamp, ActiveRequests, Lag_ms, VirtualLimit, Status
        // So Lag is index 2, ActiveRequests is index 1
        const activeReq = parseInt(columns[1]);
        const lag = parseFloat(columns[2]);

        if (!isNaN(lag)) {
            // 1. Always track Max/Min across the WHOLE test
            if (lag > maxLag) maxLag = lag;
            if (lag < minLag) minLag = lag;

            // 2. Track Overall Totals
            allTotalLag += lag;
            allCount++;

            // 3. Track STRESS Totals (Filter out idle times)
            // We count it if there are active users OR if there is actual lag (> 5ms)
            // This prevents "0ms" idle rows from dragging down your average.
            if (activeReq > 0 || lag > 5) {
                stressTotalLag += lag;
                stressCount++;
            }
        }
    });

    const avgLagOverall = allCount > 0 ? (allTotalLag / allCount).toFixed(2) : 0;
    const avgLagStress = stressCount > 0 ? (stressTotalLag / stressCount).toFixed(2) : 0;

    console.log(`\n📊 ANALYSIS REPORT FOR: ${fileName}`);
    console.log(`========================================`);
    console.log(`🔹 Total Data Points:  ${allCount}`);
    console.log(`🟢 Minimum Lag:        ${minLag} ms`);
    console.log(`🔴 Maximum Lag:        ${maxLag} ms`);
    console.log(`----------------------------------------`);
    console.log(`📉 Average (Overall):  ${avgLagOverall} ms`);
    console.log(`🔥 Average (Under Load): ${avgLagStress} ms  <-- USE THIS FOR PAPER`);
    console.log(`========================================\n`);

} catch (err) {
    console.error(`❌ Could not read file: ${fileName}`);
    console.error(err.message);
}