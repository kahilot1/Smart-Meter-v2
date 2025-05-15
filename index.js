const express = require('express');
const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
  const cards = [
    { title: 'Current Usage', value: '12.3 kWh' },
    { title: 'Total This Month', value: '320.7 kWh' },
    { title: 'Estimated Bill', value: 'Rs 1230.00' },
  ];

  const chartData = {
    labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
    values: [80, 120, 150, 90],
    unit: 'kWh'
  };

  res.render('index', { cards, chartData, linkText: 'Switch to Monetary Values', linkVal : '/w' });
});

// Extra route (for /w)
app.get('/w', (req, res) => {
    const cards = [
        { title: 'Current Usage', value: 'Rs 1230.00' },
        { title: 'Total This Month', value: 'Rs 3200.00' }
    ];
    
    const chartData = {
        labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
        values: [50, 100, 70, 90],
        unit: 'Rs'
    };
    
    res.render('index', { cards, chartData, linkText: 'Switch to kWh Values', linkVal : '/' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
