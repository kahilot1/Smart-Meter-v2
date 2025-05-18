const { Int32 } = require('bson');
const { error } = require('console');
const e = require('express');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const { double } = require('webidl-conversions');
const app = express();
const PORT = 3000;
const uri = process.env.MONGODB_URI;


//function to calculate estimated bill
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


//Connect to MongoDB
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log("Connected to MongoDB");
}).catch(err => {
  console.error("Error connecting to MongoDB", err);
}
);

// Schema and Model
const rawDataSchema = new mongoose.Schema({
    timestamp: Date,
    current: Number
  }, {
    collection: 'rawData'  // ← match the collection name exactly
  });
  
const RawData = mongoose.model('RawData', rawDataSchema);

const dailySummarySchema = new mongoose.Schema({
    date: Date,
    readingsCount: Int32,
    averageCurrent: Number,
    createdAt: Date
    }, {
    collection: 'dailySummaries'  // ← match the collection name exactly
  });

const DailySummary = mongoose.model('DailySummary', dailySummarySchema);


app.set('view engine', 'ejs');
app.use(express.static('public'));
//add the api link thing here

app.post('/api/arduinoData', (req, res) => {
    console.log('Received data from ESP32:', req.body);
    res.status(200).json({ message: 'Data received successfully' });
});

app.get('/api/kWh', async (req, res) => {
    try{
        // Find Current usage, total this month and estimated bill(averageDay * 30)
        const currentUsage = await RawData.findOne().sort({ timestamp: -1 }).limit(1);
        const totalThisMonth = await DailySummary.aggregate([
            {
              $match: {
                date: {
                  $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                }
              }
            },
            {
              $group: {
                _id: null,
                totalDays: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$date" } } },
                totalCurrentMonth: { $sum: "$averageCurrent" }
              }
            },
            {
              $project: {
                _id: 0,
                totalDays: { $size: "$totalDays" },
                totalCurrentMonth: 1
              }
            },
            {
              // If the aggregation returned no documents, this stage inserts a default document
              $unionWith: {
                coll: "DailySummary",
                pipeline: [
                  { $match: { _id: { $exists: false } } }, // matches nothing
                  {
                    $project: {
                      totalDays: { $literal: 0 },
                      totalCurrentMonth: { $literal: 0 }
                    }
                  }
                ]
              }
            },
            {
              $limit: 1 // Ensures only one document is returned, either the aggregation result or the default
            }
          ]);
        
        // Log values for debugging
        console.log("Current Usage:", currentUsage.current);
        console.log("Total Days This Month:", totalThisMonth[0].totalDays);
        averageDailyUsage = totalThisMonth[0].totalCurrentMonth / totalThisMonth[0].totalDays;
        console.log("Average Daily Usage:", averageDailyUsage);
        // Calculate estimated bill
        const estimatedBill = calculateEstimatedBill(averageDailyUsage * 30 * 24 * 240/1000);
        console.log("Estimated Bill:", estimatedBill);
        res.json({
            currentUsage: (currentUsage.current*240/1000).toFixed(2),
            totalThisMonth: (totalThisMonth[0].totalCurrentMonth*240/1000).toFixed(2),
            estimatedBill: estimatedBill.toFixed(2)
        });
    }catch(err) {
        console.error("Error fetching data", err);
        res.status(500).json({ 
            error: "Internal Server Error",
            currentUsage: "Internal Server Error",
            totalThisMonth: "Internal Server Error",
            estimatedBill: "Internal Server Error" 

        });
    }
});
app.get('/', (req, res) => {
  const cards = [
    { title: 'Live Usage / Hour', value: '12.3 kWh', id: 'currentUsage', unit: 'kWh' },
    { title: 'Total This Month', value: '320.7 kWh', id: 'totalThisMonth', unit: 'kWh' },
    { title: 'Month End Estimated Bill', value: 'Rs 1230.00', id: 'estimatedBill', unit: 'Rs' },
  ];

  const chartData = {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    values: [80, 120, 150, 90],
    unit: 'kWh'
  };

  res.render('index', { cards, chartData, linkText: 'Switch to Monetary Values', linkVal : '/w', option: 'kWh'});
});



// Extra route (for /w)
app.get('/w', (req, res) => {
    const cards = [
        { title: 'Live Usage / Hour', value: 'Rs 123.00' },
        { title: 'Daily Average', value: 'Rs 150.00' },
        { title: 'Estimated Bill', value: 'Rs 3200.00' }
    ];
    
    const chartData = {
        labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
        values: [50, 100, 70, 90],
        unit: 'Rs'
    };
    
    res.render('index', { cards, chartData, linkText: 'Switch to kWh Values', linkVal : '/', option: 'monetary' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
