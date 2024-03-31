/* eslint-disable no-param-reassign */
/* eslint-disable import/no-extraneous-dependencies */
const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const openSocket = require('socket.io-client');
const User = require('../models/userModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Patient = require('../models/patientModel');
const Doctor = require('../models/doctorModel');
const emailSender = require('../utils/email');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  user.password = undefined;
  user.active = undefined;
  user.passwordChangeAt = undefined;

  res.status(statusCode).json({
    status: 'success',
    token: token,
    data: {
      user: user,
    },
  });
};

exports.signUp = catchAsync(async (req, res, next) => {
  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    phone_number: req.body.phone_number,
    location: {
      type: 'Point',
      coordinates: req.body.coordinates,
    },
  });
  await Patient.create({ user_id: newUser.id, name: req.body.name });
  await emailSender(
    newUser,
    'Welcome to Healthify!',
    `Dear ${newUser.name}},
    Thank you for signing up for Healthify! We are excited to have you on board.
    To get started, please log in to your account using the credentials you provided during the sign-up process. 
    If you have any questions or concerns, please don't hesitate to reach out to our support team at sfe.healthify@gmail.com.
    We hope you enjoy using Healthify and look forward to helping you achieve your goals.
    Best regards,
    Shehab Ashraf
    Healthify Team`,
    `<p>Dear ${newUser.name},</p>
    <p>Thank you for signing up for Healthify! We are excited to have you on board.</p>
    <p>To get started, please log in to your account using the credentials you provided during the sign-up process.</p>
    <p>If you have any questions or concerns, please don't hesitate to reach out to our support team at sfe.healthify@gmail.com
    We hope you enjoy using Healthify and look forward to helping you achieve your goals.</p>
    <p>Best regards,</p>
    <p>Shehab Ashraf</p>
    <p>Healthify Team</p>
    `
  );
  createSendToken(newUser, 201, res);
});

exports.doctorSignUp = catchAsync(async (req, res, next) => {
  if (!(req.user.role === 'admin'))
    return next(new AppError('You do not have permisson to signup a doctor!'));
  const newUser = await User.create({
    name: req.body.name,
    role: 'doctor',
    email: req.body.email,
    phone_number: req.body.phone_number,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    location: {
      coordinates: req.body.location.coordinates,
    },
  });
  await Doctor.create({
    user_id: newUser.id,
    name: req.body.name,
    speciality: req.body.speciality,
    location: {
      coordinates: req.body.location.coordinates,
    },
    photo: newUser.photo,
  });
  createSendToken(newUser, 201, res);
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password)
    return next(new AppError('Please provide email and password!', 400));
  const user = await User.findOne({ email }).select('+password');
  if (user.active === false)
    return next(
      new AppError('Your account is not active, please contact admin!', 401)
    );
  if (!user || !(await user.checkPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password!', 401));
  }
  openSocket('http://localhost:3000');
  createSendToken(user, 200, res);
});

exports.protect = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token)
    return next(
      new AppError('You are not logged in, please login to get access.', 401)
    );

  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  const user = await User.findById(decoded.id);
  if (!user)
    return next(
      new AppError('The user of this token does not exist anymore!', 401)
    );
  if (user.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        'User recently changed the password, please login again!',
        401
      )
    );
  }
  req.user = user;
  next();
});

exports.permitOnly =
  (...roles) =>
  (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    return next(new AppError('You do not have permission!', 403));
  };

exports.forgotPassword = async (req, res, next) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user)
    return next(new AppError('The user with that email does not exist!', 404));

  const resetToken = user.createPasswordResetToken();
  user.save({ validateBeforeSave: false });

  const resetURL = `${req.protocol}://${req.get(
    'host'
  )}/api/v1/users/${resetToken}`;

  const message = `Forgot your password? Submit a patch request with your new password and password confirm to: ${resetURL}. \nIf you didn't forget your password, please ignore this email.`;

  await emailSender(
    user,
    'Your password reset token (Valid for 10 min)',
    message,
    message
  );

  res.status(200).json({
    status: 'success',
    message: 'Token has been sent to your email!',
  });
};

exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetTokenExpiry: { $gt: Date.now() },
  });
  if (!user) return next(new AppError('Token is invalid or has expired', 400));
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetTokenExpiry = undefined;
  await user.save();

  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ _id: req.user.id }).select('+password');
  if (!(await user.checkPassword(req.body.password, user.password)))
    return next(new AppError(`You've entered a wrong password!`));
  user.password = req.body.newPassword;
  user.passwordConfirm = req.body.newPasswordConfirm;
  await user.save();

  createSendToken(user, 200, res);
});

exports.reOpenApp = catchAsync(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token)
    return next(
      new AppError('You are not logged in, please login to get access.', 401)
    );

  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  const user = await User.findById(decoded.id);
  if (!user)
    return next(
      new AppError('The user of this token does not exist anymore!', 401)
    );
  if (user.active === false)
    return next(
      new AppError('Your account is not active, please contact admin!', 401)
    );
  if (user.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError(
        'User recently changed the password, please login again!',
        401
      )
    );
  }
  if (user.role === 'patient') {
    const patient = await Patient.findOne({ user_id: user.id }).populate(
      'appointments'
    );
    res.status(200).json({
      status: 'success',
      patient,
      phone_number: user.phone_number,
      email: user.email,
      photo: user.photo,
    });
  } else if (user.role === 'doctor') {
    const doctor = await Doctor.findOne({ user_id: user.id }).populate(
      'appointments'
    );
    res.status(200).json({
      status: 'success',
      doctor,
      phone_number: user.phone_number,
      email: user.email,
      photo: user.photo,
    });
  } else {
    return next(new AppError('User role not supported.', 400));
  }
});
