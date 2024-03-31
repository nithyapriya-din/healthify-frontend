const mongoose = require('mongoose');
const AppError = require('../utils/appError');

const patientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please tell your name!'],
    trim: true,
    minlength: 3,
    maxlength: 20,
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  height: {
    type: Number,
    min: [100, 'Please enter your height correctly in cm!'],
    max: [250, 'Please enter your height correctly in cm!'],
    select: false,
  },
  weight: {
    type: Number,
    min: [40, 'Please enter your weight correctly in kg!'],
    max: [200, 'Please enter your weight correctly in kg!'],
    select: false,
  },
  bmi: {
    type: Number,
    select: false,
  },
  favoriteDoctors: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
    },
  ],
  appointments: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
    },
  ],
  emrs: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EMR',
    },
  ],
  select: false,
  medicineReminders: [
    {
      name: {
        type: String,
        required: [true, 'Please enter the medicine name'],
        trim: true,
        minlength: 3,
        maxlength: 50,
      },
      type: {
        type: String,
        enum: ['pill', 'liquid', 'injection'],
        required: [true, 'Please select the type of medicine'],
      },
      frequency: {
        type: Number,
        required: [true, 'Please enter the frequency of the medicine in hours'],
        min: 1,
        max: 168,
      },
      nextReminder: {
        type: Date,
        required: [true, 'Please enter the date and time of the next reminder'],
      },
      active: {
        type: Boolean,
        default: true,
        select: false,
      },
    },
  ],
});

patientSchema.methods.checkAvailability = function (date, time, next) {
  const existingAppointment = this.appointments.find(
    (o) =>
      o.date.getTime() === new Date(date).getTime() &&
      o.time === time &&
      o.status === 'scheduled'
  );
  if (existingAppointment) {
    return next(
      new AppError(`You already have an appointment at the same time`, 400)
    );
  }
  return true;
};

const Patient = mongoose.model('Patient', patientSchema);

module.exports = Patient;
