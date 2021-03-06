'use strict';

var chai = require('chai');
var mockery = require('mockery');
var sinon = require('sinon');
var expect = chai.expect;

describe('The facebook oauth login strategy', function() {
  var deps, passportMocks, configMocks;
  var logger = {
    debug: function() {},
    err: function() {},
    info: function() {}
  };
  var dependencies = function(name) {
    return deps[name];
  };

  beforeEach(function() {
    configMocks = {
      get: function(callback) {
        return callback(null, {
          facebook: {
            client_id: '0123456789',
            client_secret: 'abcdefgh'
          }
        });
      }
    };

    passportMocks = {
      use: function() {}
    };

    deps = {
      helpers: {
        config: {
          getBaseUrl: function(callback) {
            callback(null, 'http://localhost:8080');
          }
        }
      },
      logger: logger,
      'esn-config': function() {
        return configMocks;
      }
    };

    mockery.registerMock('passport', passportMocks);
  });

  describe('The configure function', function() {
    function getModule() {
      return require('../../../../../backend/lib/strategies/facebook')(dependencies);
    }

    it('should callback with error when config service fails', function(done) {
      var msg = 'I failed';
      var urlErr = new Error(msg);

      deps.helpers.config.getBaseUrl = function(callback) {
        callback(urlErr);
      };

      getModule().configure(function(err) {
        expect(err.message).to.equal(msg);
        done();
      });
    });

    it('should callback with error when helpers.config.getBaseUrl service fails', function(done) {
      var msg = 'I failed';
      configMocks.get = function(callback) {
        callback(new Error(msg));
      };

      getModule().configure(function(err) {
        expect(err.message).to.equal(msg);
        done();
      });
    });

    it('should register facebook-login passport if facebook is configured', function(done) {
      passportMocks.use = function(name) {
        expect(name).to.equal('facebook-login');
      };

      getModule().configure(done);
    });

    it('should callback with error if facebook is not configured', function(done) {
      configMocks.get = function(callback) {
        return callback(null, {});
      };

      getModule().configure(function(err) {
        expect(err).to.deep.equal(new Error('Facebook OAuth is not configured'));
        done();
      });
    });

    describe('The FB strategy callback', function() {

      beforeEach(function() {
        var self = this;
        var FacebookStrategy = function(options, callback) {
          this.options = options;
          this.callback = callback;
        };

        mockery.registerMock('passport', {
          use: function(name, strategy) {
            self.fbStrategy = strategy;
          }
        });

        mockery.registerMock('passport-facebook', {
          Strategy: FacebookStrategy
        });

        configMocks.get = function(callback) {
          return callback(null, {
            facebook: {
              client_id: '1',
              client_secret: 'secret'
            }
          });
        };
      });

      it('should search and set user from facebook data', function(done) {
        var self = this;
        var request = {};
        var accessToken = '1';
        var refreshToken = '2';
        var profile = {
          id: '123'
        };
        var user = {_id: '456'};

        var spy = sinon.spy();
        deps.user = {
          find: function(options, callback) {
            spy();
            expect(options).to.deep.equals({
              'accounts.type': 'oauth',
              'accounts.data.provider': 'facebook',
              'accounts.data.id': profile.id
            });
            callback(null, user);
          }
        };

        getModule().configure(function() {
          self.fbStrategy.callback(request, accessToken, refreshToken, profile, function(err, u) {
            expect(spy).to.have.been.called;
            expect(u).to.deep.equals(user);
            expect(request.user).to.deep.equals(user);
            done();
          });
        });
      });

      it('should call callback and not set user when user is not found', function(done) {
        var self = this;
        var request = {};
        var accessToken = '1';
        var refreshToken = '2';
        var profile = {
          id: '123'
        };
        deps.user = {
          find: function(options, callback) {
            callback();
          }
        };

        getModule().configure(function() {
          self.fbStrategy.callback(request, accessToken, refreshToken, profile, done);
        });
      });

      it('should return error when user#find fails', function(done) {
        var self = this;
        var request = {};
        var accessToken = '1';
        var refreshToken = '2';
        var profile = {
          id: '123'
        };
        var userError = new Error('I failed');
        deps.user = {
          find: function(options, callback) {
            callback(userError);
          }
        };

        getModule().configure(function() {
          self.fbStrategy.callback(request, accessToken, refreshToken, profile, function(err) {
            expect(err).to.equals(userError);
            done();
          });
        });
      });
    });
  });
});

