const { connect } = require('./db');

module.exports = async (req, res) => {
  try {
    const sku = req.query.sku || (req.url && req.url.split('/').pop());
    if(!sku) return res.status(400).send('sku required');
    const db = await connect();
    const item = await db.collection('items').findOne({ sku });
    res.setHeader('Content-Type','application/json');
    res.status(200).send(JSON.stringify(item || {}));
  } catch(err){
    console.error(err);
    res.status(500).send('error');
  }
};
