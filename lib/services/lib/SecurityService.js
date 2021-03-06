const debug = require('debug')('@laborx/profile.backend:SecurityService')

const assert = require('assert')
const keystone = require('keystone')
const config = require('config')
const { set } = require('lodash')
const { Message } = requireRoot('lib/mail')
const { WebError } = requireRoot('lib/errors')
const {
  ProfileModel,
  PersonModel,
  VerificationRequestLevel1Model,
  VerificationRequestLevel2Model,
  VerificationRequestLevel3Model,
  VerificationRequestLevel4Model,
  ConfirmationRequestLevel2Model,
  NotificationToggleModel
} = requireRoot('lib/models')

const { confirmTemplate } = requireRoot('mail')

const SecurityUser = keystone.list('SecurityUser')
const SecurityToken = keystone.list('SecurityToken')
const SecurityCheck = keystone.list('SecurityCheck')
const SecuritySignature = keystone.list('SecuritySignature')
const VerificationRequest = keystone.list('VerificationRequest')

class SecurityService {
  async selectPerson (address) {
    const signature = await SecuritySignature.model
      .findOne({
        value: address.toLowerCase(),
        type: 'ethereum-address'
      })
      .populate('user')
      .exec()
    return PersonModel.fromMongo(signature.user, { address: signature.value })
  }

  async selectPersons (addresses) {
    const signatures = await SecuritySignature.model
      .find({
        value: { $in: addresses.map(a => a.toLowerCase()) },
        type: 'ethereum-address'
      })
      .populate('user')

    return signatures.map(signature => PersonModel.fromMongo(signature.user, { address: signature.value }))
  }

  async selectProfile (user) {
    const data = await SecurityUser.model
      .findOne({ _id: user._id })
      .populate('level1.avatar')
      .populate('level3.attachments')
      .populate('level4.attachments')
      .populate({
        path: 'requests',
        populate: [
          { path: 'level1.avatar' },
          { path: 'level3.attachments' },
          { path: 'level4.attachments' }
        ]
      })
    return ProfileModel.fromMongo(data)
  }

  async requireSignature ({ type, value }) {
    const signature = await SecuritySignature.model
      .findOne({ value, type })
      .populate('user')

    if (signature) {
      return signature
    }

    const u = await SecurityUser.model
      .create({ name: `${type}:${value}` })
    const s = await SecuritySignature.model
      .create({ user: u._id, type, value })
    return SecuritySignature.model
      .findOne({ _id: s._id })
      .populate('user')
  }

  async findToken ({ token }) {
    return SecurityToken.model
      .findOne({ token })
      .populate('user')
  }

  async upsertToken ({ user, purpose }) {
    let token = await SecurityToken.model
      .findOne({
        user: user._id,
        purpose: purpose
      })
    if (token) {
      await token.save()
    } else {
      token = await SecurityToken.model
        .create({
          user: user._id,
          purpose: purpose
        })
    }
    return SecurityToken.model
      .findOne({ _id: token._id })
      .populate('user')
  }

  async removeToken ({ token }) {
    const result = await SecurityToken.model
      .findOne({ token })
      .populate('user')
      .exec()
    await result.remove()
    return result
  }

  async upsertLevel1Request (user, requestModel) {
    assert(requestModel instanceof VerificationRequestLevel1Model)
    const request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-1',
      status: 'created'
    })
    if (request) {
      request.level1 = {
        userName: requestModel.userName,
        birthDate: requestModel.birthDate,
        avatar: requestModel.avatar,
        validationComment: null,
        isValid: false
      }
      await request.save()
    } else {
      await VerificationRequest.model
        .create({
          user: user._id,
          level: 'level-1',
          level1: {
            userName: requestModel.userName,
            birthDate: requestModel.birthDate,
            avatar: requestModel.avatar
          }
        })
    }
  }

  async upsertLevel2Request (user, requestModel) {
    assert(requestModel instanceof VerificationRequestLevel2Model)
    let request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-2',
      status: 'created'
    })
    if (request) {
      request.level2 = {
        email: requestModel.email,
        phone: requestModel.phone,
        isEmailConfirmed: requestModel.email === request.level2.email
          ? request.level2.isEmailConfirmed
          : false,
        isPhoneConfirmed: requestModel.phone === request.level2.phone
          ? request.level2.isPhoneConfirmed
          : false,
        validationComment: null,
        isValid: false
      }
      await request.save()
    } else {
      request = await VerificationRequest.model
        .create({
          user: user._id,
          level: 'level-2',
          level2: {
            email: requestModel.email,
            phone: requestModel.phone,
            isEmailConfirmed: requestModel.email === user.level2.email,
            isPhoneConfirmed: requestModel.phone === user.level2.phone
          }
        })
    }
    if (!request.level2.isPhoneConfirmed) {
      await this.validatePhone(user)
    }
    if (!request.level2.isEmailConfirmed) {
      await this.validateEmail(user)
    }
  }

  async upsertLevel3Request (user, requestModel) {
    assert(requestModel instanceof VerificationRequestLevel3Model)
    const request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-3',
      status: 'created'
    })
    if (request) {
      request.level3 = {
        passport: requestModel.passport,
        expirationDate: requestModel.expirationDate,
        attachments: requestModel.attachments
      }
      await request.save()
    } else {
      await VerificationRequest.model
        .create({
          user: user._id,
          level: 'level-3',
          level3: {
            passport: requestModel.passport,
            expirationDate: requestModel.expirationDate,
            attachments: requestModel.attachments
          }
        })
    }
  }

  async upsertLevel4Request (user, requestModel) {
    assert(requestModel instanceof VerificationRequestLevel4Model)
    const request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-4',
      status: 'created'
    })
    if (request) {
      request.level4 = {
        country: requestModel.country,
        state: requestModel.state,
        city: requestModel.city,
        zip: requestModel.zip,
        addressLine1: requestModel.addressLine1,
        addressLine2: requestModel.addressLine2,
        attachments: requestModel.attachments
      }
      await request.save()
    } else {
      await VerificationRequest.model
        .create({
          user: user._id,
          level: 'level-4',
          level4: {
            country: requestModel.country,
            state: requestModel.state,
            city: requestModel.city,
            zip: requestModel.zip,
            addressLine1: requestModel.addressLine1,
            addressLine2: requestModel.addressLine2,
            attachments: requestModel.attachments
          }
        })
    }
  }

  async validatePhone (user) {
    const request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-2',
      status: 'created'
    })

    if (!request || !request.level2 || request.level2.isPhoneConfirmed) {
      throw new WebError('Illegal state', 401)
    }

    await SecurityCheck.model.remove({
      user: user._id,
      type: 'confirm-phone'
    })

    const checkPhone = await SecurityCheck.model.create({
      user: user._id,
      type: 'confirm-phone',
      payload: request.level2.phone
    })

    debug(`[confirm-phone] user: ${user._id}, check: ${checkPhone.check}`)
  }

  async validateEmail (user) {
    const request = await VerificationRequest.model.findOne({
      user: user._id,
      level: 'level-2',
      status: 'created'
    })

    if (!request || !request.level2 || request.level2.isEmailConfirmed) {
      throw new WebError('Illegal state', 401)
    }

    await SecurityCheck.model.remove({
      user: user._id,
      type: 'confirm-email'
    })

    const checkEmail = await SecurityCheck.model.create({
      user: user._id,
      type: 'confirm-email',
      payload: request.level2.email
    })

    debug(`[confirm-email] user: ${user._id}, check: ${checkEmail.check}`)

    const { subject, content } = confirmTemplate({
      baseURL: config.get('mail.baseURL'),
      username: user.name,
      check: checkEmail.check
    })
    const message = new Message({
      to: request.level2.email,
      subject,
      html: content
    })

    await message.send()
  }

  async confirmLevel2Request (user, requestModel) {
    assert(requestModel instanceof ConfirmationRequestLevel2Model)
    const request = await VerificationRequest.model
      .findOne({
        user: user._id,
        level: 'level-2',
        status: 'created'
      })
    assert(request != null)

    let isEmailVerified = false
    let isEmailTried = false
    debug('requestModel.emailCode', requestModel.emailCode)
    if (requestModel.emailCode) {
      isEmailTried = true
      const checkEmail = await SecurityCheck.model
        .findOne({
          user: user._id,
          type: 'confirm-email',
          payload: request.level2.email,
          check: requestModel.emailCode
        })
      debug('checkEmail', checkEmail)
      if (checkEmail) {
        await checkEmail.remove()
        request.level2.isEmailConfirmed = true
        isEmailVerified = true
      }
    }

    let isPhoneVerified = false
    let isPhoneTried = false
    if (requestModel.phoneCode) {
      isPhoneTried = true
      const checkPhone = await SecurityCheck.model
        .findOne({
          user: user._id,
          type: 'confirm-phone',
          payload: request.level2.phone,
          check: requestModel.phoneCode
        })
      if (checkPhone) {
        await checkPhone.remove()
        request.level2.isPhoneConfirmed = true
        isPhoneVerified = true
      }
    }

    if (isPhoneVerified || isEmailVerified) {
      await request.save()
    }

    return {
      isEmailTried,
      isEmailVerified,
      isPhoneTried,
      isPhoneVerified
    }
  }

  async updateNotification (user, requestModel) {
    assert(requestModel instanceof NotificationToggleModel)
    set(user, `notifications.${requestModel.domain}.${requestModel.type}.${requestModel.name}`, requestModel.value)
    await user.save()
  }
}

module.exports = SecurityService
