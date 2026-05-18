const express = require('express');
const { disparar } = require('../controllers/boletimController');

const router = express.Router();

router.post('/disparar', disparar);

module.exports = router;
