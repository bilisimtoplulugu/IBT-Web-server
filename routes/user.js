/* Packages I used */
import express from 'express';
import bcrypt from 'bcrypt';
import randomstring from 'randomstring';
import jwt from 'jsonwebtoken';
import fileUpload from 'express-fileupload';
import mongoose from 'mongoose';

import User from '../models/user';
import Event from '../models/event';

import sendCodeToVerifyEmail from '../utils/sendCodeToVerifyEmail';
import {client} from '../server';

const router = express.Router();
router.use(
  fileUpload({
    limits: {fileSize: 2048},
  })
);

/* router.get('/', (req, res) => {
  console.log('/user get');
  client.setex('username', 3600, 'ahmet');
  client.get('username', (err, data) => {
    console.log(data);
    console.log(err);
  });
}); */

router.get('/all-joined-events', async (req, res) => {
  const {username} = req.query;

  if (!username) return res.status(400).send('Please fill all fields.');

  const user = await User.findOne({username})
    .select({joinedEvents: 1})
    .populate(
      'joinedEvents',
      '_id title subtitle description organizer seoUrl date'
    )
    .exec();

  if (!user) return res.status(404).send('User not found.');

  const {joinedEvents} = user;

  return res.send(joinedEvents);
});

router.get('/last-events', async (req, res) => {
  const {userId} = req.query;
  if (!userId) return res.status(400).send('Please fill all fields.');

  const user = await User.findById(userId).select({
    joinedEvents: 1,
  });
  const eventDetails = await Event.find({_id: {$in: user.joinedEvents}});
  res.send(eventDetails);
});

router.get('/:username', async (req, res) => {
  const {username} = req.params;

  const user = await User.findOne({username})
    .select({
      _id: 1,
      name: 1,
      surname: 1,
      email: 1,
      username: 1,
      joinedEvents: 1,
    })
    .populate('joinedEvents', 'seoUrl')
    .exec();

  if (!user) return res.status(404).send('User not found.');

  res.send(user);
});

// POST request for /user/register endpoint
router.post('/register', async (req, res) => {
  const {email, password} = req.body;

  // hash variable represents that hashed form for our plain password
  const hash = await bcrypt.hash(password, 10);

  req.body._id = mongoose.Types.ObjectId();
  req.body.username = email.split('@')[0];
  req.body.password = hash;

  // generate new user on db
  const user = await User.create(req.body);

  const token = await jwt.sign({user}, process.env.JWT_SECRET_KEY);
  res.json({user, token});
});

// POST request for /user/login endpoint
router.post('/login', async (req, res) => {
  const {email, password} = req.body;

  const user = await User.findOne()
    .or([{email}, {username: email}])
    .select({
      _id: 1,
      name: 1,
      surname: 1,
      email: 1,
      password: 1,
      username: 1,
      joinedEvents: 1,
    })
    .populate('joinedEvents', 'seoUrl')
    .exec();
  if (!user) return res.status(404).send('User not found.');

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).send('Incorrect Pass');

  const token = await jwt.sign({user}, process.env.JWT_SECRET_KEY);
  res.json({user, token});
});

router.post('/auth', async (req, res) => {
  const {token} = req.body;

  if (!token) return res.status(400).send('Unauthorized.');

  try {
    const {
      user: {_id},
    } = await jwt.verify(token, process.env.JWT_SECRET_KEY);

    const user = await User.findById(_id)
      .select({
        _id: 1,
        name: 1,
        surname: 1,
        email: 1,
        username: 1,
        joinedEvents: 1,
      })
      .populate('joinedEvents', 'seoUrl')
      .exec();

    return res.send(user);
  } catch (e) {
    console.log(e);
    return res.status(400).send('Invalid token.');
  }
});

router.post('/send-code-to-email', async (req, res) => {
  const {emailTo} = req.body;
  const confirmCode = randomstring.generate(6);

  if (!emailTo) return res.status(400).send('Please fill all fields.');

  const {length: isRegistered} = await User.count({email: emailTo});

  if (isRegistered > 0)
    return res.status(400).send('This e-mail address already registered.');

  console.log(confirmCode);
  //await sendCodeToVerifyEmail(emailTo, confirmCode);
  const token = await jwt.sign(
    {email_verification: confirmCode},
    process.env.JWT_SECRET_KEY
  );
  res.send(token);
});

router.post('/email-verification', async (req, res) => {
  const {code, token} = req.body;

  if (!code || !token) return res.status(400).send('Please fill all fields.');

  try {
    const {email_verification} = await jwt.verify(
      token,
      process.env.JWT_SECRET_KEY
    );

    if (code !== email_verification)
      return res.status(401).send('Incorrect Confirm Code');

    res.send();
  } catch (e) {
    res.status(401).send('Invalid Token');
  }
});

router.patch('/change-password', async (req, res) => {
  const {userId, oldPass, newPass, newPassAgain} = req.body;
  if (!userId || !oldPass || !newPass || !newPassAgain)
    return res.status(400).send('Please fill all fields.');

  if (newPass !== newPassAgain)
    return res.status(400).send('Password does not match.');

  const user = await User.findById(userId);
  if (!user) return res.status(404).send('User not found.');

  const passCheck = await bcrypt.compare(oldPass, user.password);
  if (!passCheck) return res.status(400).send('Incorrect old password.');

  const hash = await bcrypt.hash(newPass, 10);
  user.password = hash;
  user.save();

  res.send();
});

router.patch('/change-personal', async (req, res) => {
  const {userId, name, surname, username, email} = req.body;
  if (!userId || !name || !surname || !email)
    return res.status(400).send('Please fill all fields.');

  const user = await User.findById(userId);
  if (!user) return res.status(404).send('User not found.');

  const {length: existingControl} = await User.find().or([{username}, {email}]);
  if (existingControl > 2)
    return res.status(404).send('This e-mail or username is already using.');

  user.name = name;
  user.surname = surname;
  user.username = username;
  user.email = email;
  user.save();

  res.send();
});

router.patch('/change-profile-photo', (req, res) => {
  /* TODO: HERE COULD BE ASYNC AWAIT */
  const {userId} = req.query;

  const file = req.files.file;

  file.mv(`${__dirname}/../assets/images/${userId}.png`, (err) => {
    if (err) return res.status(500).send(err);

    return res.send();
  });
});

export default router;
