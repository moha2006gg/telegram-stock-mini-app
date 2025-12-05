const { connect } = require('./db');

module.exports = async (req, res) => {
  try {
    const db = await connect();
    const items = await db.collection('items').find({}).toArray();
    res.setHeader('Content-Type','application/json');
    res.status(200).send(JSON.stringify(items));
  } catch(err){
    console.error(err);
    res.status(500).send('error');
  }
};
