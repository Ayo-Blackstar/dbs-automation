require('dotenv').config();
const express = require('express');
const app = express();

const stripeRoutes = require('./routes/stripe');
app.use('/stripe', stripeRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const payitmonthlyRoutes = require('./routes/payitmonthly');
const ghlRoutes = require('./routes/ghl');

app.use('/payitmonthly', payitmonthlyRoutes);
app.use('/ghl', ghlRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'DBS Automation is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
