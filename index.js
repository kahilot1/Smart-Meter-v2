const { Int32 } = require('bson');
const { error } = require('console');
const e = require('express');
const express = require('express');
const mongoose = require('mongoose');
const { diff } = require('util');
require('dotenv').config();
const { double } = require('webidl-conversions');
const app = express();
app.use(express.json());
const PORT = 3000;
const uri = process.env.MONGODB_URI;


//functions to calculate estimated bill
function calculateEstimatedBill(currentUsage) {
    if (currentUsage < 0) {
        return 0;
    }

    const rates = [
        [25, 3.16],
        [25, 4.38],
        [25, 4.74],
        [25, 5.45],
        [100, 6.15],
        [50, 7.02],
        [50, 7.90],
        [Infinity, 8.77]
    ];

    let total = 0;
    let remainingUsage = currentUsage;

    for (let [band_kwh, rate_per_kwh] of rates) {
        if (remainingUsage > 0) {
            if (remainingUsage <= band_kwh) {
                total += remainingUsage * rate_per_kwh;
                remainingUsage = 0;
            } else {
                total += band_kwh * rate_per_kwh;
                remainingUsage -= band_kwh;
            }
        } else {
            break;
        }
    }

    const minimumCharge = 184.00;

    if (total < minimumCharge) {
        return minimumCharge;
    }

    return total;
}
function calculateEstimatedBillMod(currentUsage) {
  if (currentUsage < 0) {
      return 0;
  }

  const rates = [
      [25, 3.16],
      [25, 4.38],
      [25, 4.74],
      [25, 5.45],
      [100, 6.15],
      [50, 7.02],
      [50, 7.90],
      [Infinity, 8.77]
  ];

  let total = 0;
  let remainingUsage = currentUsage;

  for (let [band_kwh, rate_per_kwh] of rates) {
      if (remainingUsage > 0) {
          if (remainingUsage <= band_kwh) {
              total += remainingUsage * rate_per_kwh;
              remainingUsage = 0;
          } else {
              total += band_kwh * rate_per_kwh;
              remainingUsage -= band_kwh;
          }
      } else {
          break;
      }
  }


  return total;
}



//Connect to MongoDB
mongoose.connect(uri, {
}).then(() => {
  console.log("Connected to MongoDB");
}).catch(err => {
  console.error("Error connecting to MongoDB", err);
}
);

// Schema and Model
const rawDataSchema = new mongoose.Schema({
    timestamp: Date,
    current: Number,
    kWh: Number
  }, {
    collection: 'rawData'  // ← match the collection name exactly
  });
  
const RawData = mongoose.model('RawData', rawDataSchema);

app.set('view engine', 'ejs');
app.use(express.static('public'));

//add the api link thing here
app.post('/api/arduinoData', async (req, res) => {
  try {
    const { voltage, timestamp } = req.body;

    if (!voltage || !timestamp) {
      return res.status(400).json({ message: 'Missing voltage or timestamp' });
    }

    // Calculate current from voltage
    const current = voltage * 30;

    // Parse timestamp from client
    const currentTimestamp = new Date(timestamp);

    // Fetch last reading from DB (assuming sorted by timestamp descending)
    const lastEntry = await RawData.findOne().sort({ timestamp: -1 });

    let kWh = 0;

    if (lastEntry) {
      // Time difference in hours
      const diffMs = currentTimestamp - lastEntry.timestamp;
      if (diffMs < 0) {
        return res.status(400).json({ message: 'Timestamp is earlier than the last entry' });
      }
      // Make sure reading are not too far apart (maximum 3 seconds)
      if (diffMs > 3000) {
        diffMs = 3000; // cap to 3 seconds
      }
      const diffHrs = diffMs / (1000 * 60 * 60);

      // Calculate power in kW (assuming you have voltage or calculate power)
      // Here, assuming current is in amps and voltage constant (say 230V)
      const powerKW = (230 * current) / 1000; // watts to kW

      // Energy = power * time
      kWh = powerKW * diffHrs;
      if (kWh < 0) kWh = 0; // just in case timestamps messed up
    }else{
      // If no last entry, assume this is the first reading
      kWh = 0; // No previous data to compare against
    }

    const newEntry = new RawData({
      timestamp: currentTimestamp,
      current: current,
      kWh: kWh
    });

    await newEntry.save();

    res.status(200).json({ message: 'Data received successfully', kWh: kWh.toFixed(4) });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Data not received' });
  }
});


app.get('/api/monetary/fast', async (req, res) => {
  try{
    let currentUsage = await RawData.findOne().sort({ timestamp: -1 }).limit(1);

    currentUsage = calculateEstimatedBillMod(currentUsage.current*240/1000);

    res.json({
      currentUsage: currentUsage.toFixed(2)
    });

  }catch(err) {
    console.error("Error fetching data", err);
    res.status(500).json({ 
        error: "Internal Server Error"
    });
  }
});
app.get('/api/kWh/fast', async (req, res) => {
  try{
    let currentUsage = await RawData.findOne().sort({ timestamp: -1 }).limit(1);

    currentUsage = currentUsage.current*240/1000;

    res.json({
      currentUsage: currentUsage.toFixed(2)
    });

  }catch(err) {
    console.error("Error fetching data", err);
    res.status(500).json({ 
        error: "Internal Server Error"
    });
  }
});

app.get('/api/monetary/slow', async (req, res) => {
  try{
    // Find Total today and mont end estimated bill(averageDay * 30)
    const totalToday = await RawData.aggregate([
      {
        $match: {
          timestamp: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lt: new Date(new Date().setHours(24, 0, 0, 0))
          }
        }
      },
      {
        $group: {
          _id: null,
          totalEnergyToday: { $sum: "$kWh" }
        }
      },
      {
        $project: {
          _id: 0,
          totalEnergyToday: 1
        }
      }]);

    const averageDailyUsage = await RawData.aggregate([
      {
        $match: {
          timestamp: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
          }
        }
      },
      {
        $group: {
          _id: { day: { $dayOfMonth: "$timestamp" } },
          dailyTotal: { $sum: "$kWh" }
        }
      },
      {
        $group: {
          _id: null,
          averageDailyUsage: { $avg: "$dailyTotal" }
        }
      },
      {
        $project: {
          _id: 0,
          averageDailyUsage: 1
        }
      }]);
    const estimatedBill = calculateEstimatedBill(averageDailyUsage[0].averageDailyUsage * 30 * 24);
    let totalTodayValue = totalToday[0] ? totalToday[0].totalEnergyToday : 0;
    totalTodayValue = calculateEstimatedBillMod(totalTodayValue);

    res.json({
      dailyAverage: (totalTodayValue).toFixed(2),
      estimatedBill: (estimatedBill).toFixed(2)
    })
  }catch(err) {
    console.error("Error fetching data", err);
    res.status(500).json({ 
        error: "Internal Server Error"
    });
  }
  
});
app.get('/api/kWh/slow', async (req, res) => {
  try{
    // Find Total today and mont end estimated bill(averageDay * 30)
    const totalToday = await RawData.aggregate([
      {
        $match: {
          timestamp: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lt: new Date(new Date().setHours(24, 0, 0, 0))
          }
        }
      },
      {
        $group: {
          _id: null,
          totalEnergyToday: { $sum: "$kWh" }
        }
      },
      {
        $project: {
          _id: 0,
          totalEnergyToday: 1
        }
      }]);

    const averageDailyUsage = await RawData.aggregate([
      {
        $match: {
          timestamp: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            $lt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
          }
        }
      },
      {
        $group: {
          _id: { day: { $dayOfMonth: "$timestamp" } },
          dailyTotal: { $sum: "$kWh" }
        }
      },
      {
        $group: {
          _id: null,
          averageDailyUsage: { $avg: "$dailyTotal" }
        }
      },
      {
        $project: {
          _id: 0,
          averageDailyUsage: 1
        }
      }]);
    const estimatedBill = calculateEstimatedBill(averageDailyUsage[0].averageDailyUsage * 30 * 24);
    let totalTodayValue = totalToday[0] ? totalToday[0].totalEnergyToday : 0;

    res.json({
      dailyAverage: (totalTodayValue).toFixed(2),
      estimatedBill: (estimatedBill).toFixed(2)
    })
  }catch(err) {
    console.error("Error fetching data", err);
    res.status(500).json({ 
        error: "Internal Server Error"
    });
  }
  
});

// app.get('/api/monetary', async (req, res) => {
//   try{
//   let currentUsage = await RawData.findOne().sort({ timestamp: -1 }).limit(1);
//   currentUsage = calculateEstimatedBillMod(currentUsage.current);

//   let totalThisMonth = await DailySummary.aggregate([
//     {
//       $match: {
//         date: {
//           $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
//         }
//       }
//     },
//     {
//       $group: {
//         _id: null,
//         totalDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$date" } } },
//         totalCurrentMonth: { $sum: "$averageCurrent" }
//       }
//     },
//     {
//       $project: {
//         _id: 0,
//         totalDays: { $size: "$totalDays" },
//         totalCurrentMonth: 1
//       }
//     },
//     {
//       // If the aggregation returned no documents, this stage inserts a default document
//       $unionWith: {
//         coll: "DailySummary",
//         pipeline: [
//           { $match: { _id: { $exists: false } } }, // matches nothing
//           {
//             $project: {
//               totalDays: { $literal: 0 },
//               totalCurrentMonth: { $literal: 0 }
//             }
//           }
//         ]
//       }
//     },
//     {
//       $limit: 1 // Ensures only one document is returned, either the aggregation result or the default
//     }
//   ]);

//   let averageDailyUsage = totalThisMonth[0].totalCurrentMonth / totalThisMonth[0].totalDays;
//   averageDailyUsage = averageDailyUsage * 240 / 1000;


//   res.json({

//     currentUsage: currentUsage.toFixed(2),
//     dailyAverage: calculateEstimatedBillMod(averageDailyUsage).toFixed(2),
//     estimatedBill: calculateEstimatedBill(averageDailyUsage * 30 * 24).toFixed(2),

//   });}catch(err) {
//     console.error("Error fetching data", err);
//     res.status(500).json({ 
//         error: "Internal Server Error",
//         currentUsage: "Internal Server Error",
//         totalThisMonth: "Internal Server Error",
//         dailyAverage: "Internal Server Error" 

//     });
//   }

// });

// app.get('/api/kWh', async (req, res) => {
//     try{
//         // Find Current usage, total this month and estimated bill(averageDay * 30)
//         const currentUsage = await RawData.findOne().sort({ timestamp: -1 }).limit(1);
//         const totalThisMonth = await DailySummary.aggregate([
//             {
//               $match: {
//                 date: {
//                   $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
//                 }
//               }
//             },
//             {
//               $group: {
//                 _id: null,
//                 totalDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$date" } } },
//                 totalCurrentMonth: { $sum: "$averageCurrent" }
//               }
//             },
//             {
//               $project: {
//                 _id: 0,
//                 totalDays: { $size: "$totalDays" },
//                 totalCurrentMonth: 1
//               }
//             },
//             {
//               // If the aggregation returned no documents, this stage inserts a default document
//               $unionWith: {
//                 coll: "DailySummary",
//                 pipeline: [
//                   { $match: { _id: { $exists: false } } }, // matches nothing
//                   {
//                     $project: {
//                       totalDays: { $literal: 0 },
//                       totalCurrentMonth: { $literal: 0 }
//                     }
//                   }
//                 ]
//               }
//             },
//             {
//               $limit: 1 // Ensures only one document is returned, either the aggregation result or the default
//             }
//           ]);
        
//         // Log values for debugging
//         console.log("Current Usage:", currentUsage.current);
//         console.log("Total Days This Month:", totalThisMonth[0].totalDays);
//         averageDailyUsage = totalThisMonth[0].totalCurrentMonth / totalThisMonth[0].totalDays;
//         console.log("Average Daily Usage:", averageDailyUsage);
//         // Calculate estimated bill
//         const estimatedBill = calculateEstimatedBill(averageDailyUsage * 30 * 24 * 240/1000);
//         console.log("Estimated Bill:", estimatedBill);
//         res.json({
//             currentUsage: (currentUsage.current*240/1000).toFixed(2),
//             totalThisMonth: (totalThisMonth[0].totalCurrentMonth*240/1000).toFixed(2),
//             estimatedBill: estimatedBill.toFixed(2)
//         });
//     }catch(err) {
//         console.error("Error fetching data", err);
//         res.status(500).json({ 
//             error: "Internal Server Error",
//             currentUsage: "Internal Server Error",
//             totalThisMonth: "Internal Server Error",
//             estimatedBill: "Internal Server Error" 

//         });
//     }
// });

app.get('/', (req, res) => {
  const cards = [
    { title: 'Live Usage / Hour', value: '12.3 kWh', id: 'currentUsage', unit: 'kWh' },
    { title: 'Total Today', value: '320.7 kWh', id: 'dailyAverage', unit: 'kWh' },
    { title: 'Month End Estimated Bill', value: 'Rs 1230.00', id: 'estimatedBill', unit: 'Rs' },
  ];

  const chartData = {
    labels: ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'],
    values: [92.3, 78.1, 66.5, 54.7, 99.2, 70.0, 88.9, 59.6,
      85.4, 73.3, 63.1, 97.5, 51.8, 60.4, 55.9, 80.2,
      68.7, 90.1, 76.6, 98.0, 58.3, 65.2, 87.7, 72.5],
    unit: 'kWh'
  };

  res.render('index', { cards, chartData, linkText: 'Switch to Monetary Values', linkVal : '/w', option: 'kWh'});
});



// Extra route (for /w)
app.get('/w', (req, res) => {
    const cards = [
        { title: 'Live Usage / Hour', value: 'Rs 123.00', id: 'currentUsage', unit: 'Rs' },
        { title: 'Total Today', value: 'Rs 150.00', id: 'dailyAverage', unit: 'Rs' },
        { title: 'Month End Estimated Bill', value: 'Rs 3200.00', id: 'estimatedBill', unit: 'Rs' },
    ];
    
    const chartData = {
        labels: ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'],
        values: [117.3, 135.9, 141.2, 89.5, 125.0, 93.6, 144.8, 109.2,
          85.7, 120.3, 97.4, 106.6, 148.9, 130.5, 101.1, 137.8,
          112.7, 83.3, 91.0, 147.2, 104.9, 139.4, 128.6, 100.0],
        unit: 'Rs/Hour'
    };
    
    res.render('index', { cards, chartData, linkText: 'Switch to kWh Values', linkVal : '/', option: 'monetary' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
