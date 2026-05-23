const { createAuthRepository } = require('./auth.repository');
const { createAuthService } = require('./service');
const { createAuthRouter } = require('./routes');

function createAuthModule(deps) {
  const authRepository = deps.authRepository || createAuthRepository({
    userRepository: deps.userRepository,
    dbPool: deps.dbPool,
    db: deps.db,
    otpExpireSeconds: deps.otpExpireSeconds,
    logger: deps.logger
  });
  const authService = deps.authService || createAuthService({
    authRepository,
    smsService: deps.smsService,
    jwt: deps.jwt,
    jwtSecret: deps.jwtSecret,
    tokenExpiresIn: deps.tokenExpiresIn,
    logger: deps.logger
  });
  const router = createAuthRouter({
    authService,
    errorsRepository: deps.errorsRepository,
    logger: deps.logger
  });

  return {
    router,
    authRepository,
    authService
  };
}

module.exports = { createAuthModule };
