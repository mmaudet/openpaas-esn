'use strict';

/* global chai: false */
/* global moment: false */
/* global sinon: false */

var expect = chai.expect;

describe('The Unified Inbox Angular module services', function() {

  var nowDate = new Date('2015-08-20T04:00:00Z'),
      localTimeZone = 'Europe/Paris',
      attendeeService, isMobile, config;

  beforeEach(function() {
    angular.mock.module('esn.jmap-client-wrapper');
    angular.mock.module('esn.session');
    angular.mock.module('esn.core');
    angular.mock.module('angularMoment');
    angular.mock.module('linagora.esn.unifiedinbox');
    angular.mock.module('jadeTemplates');
  });

  beforeEach(module(function($provide) {
    isMobile = false;
    config = config || {};

    $provide.value('localTimezone', 'UTC');
    $provide.constant('moment', function(argument) {
      return moment.tz(argument || nowDate, localTimeZone);
    });
    $provide.value('attendeeService', attendeeService = { addProvider: angular.noop });
    $provide.value('deviceDetector', {
      isMobile: function() {
        return isMobile;
      }
    });
    $provide.value('esnConfig', function(key, defaultValue) {
      return $q.when(angular.isDefined(config[key]) ? config[key] : defaultValue);
    });
  }));

  afterEach(function() {
    config = {};
  });

  describe('The inboxConfig factory', function() {

    var $rootScope, inboxConfig;

    function checkValue(key, defaultValue, expected, done) {
      inboxConfig(key, defaultValue).then(function(value) {
        expect(value).to.equal(expected);

        done();
      }, done);

      $rootScope.$digest();
    }

    beforeEach(inject(function(_$rootScope_, _inboxConfig_) {
      inboxConfig = _inboxConfig_;
      $rootScope = _$rootScope_;

      config['linagora.esn.unifiedinbox.testKey'] = 'testValue';
    }));

    it('should delegate to esnConfig, prefixing the key with the module name', function(done) {
      checkValue('testKey', undefined, 'testValue', done);
    });

    it('should delegate to esnConfig with default value, prefixing the key with the module name', function(done) {
      checkValue('not.existing', 'abc', 'abc', done);
    });

  });

  describe('The generateJwtToken service', function() {

    var $httpBackend, generateJwtToken;
    beforeEach(angular.mock.inject(function(_$httpBackend_, _generateJwtToken_) {
      $httpBackend = _$httpBackend_;
      generateJwtToken = _generateJwtToken_;
    }));

    it('should resolve response data on success', function(done) {
      var responseData = { key: 'value' };
      $httpBackend.expectPOST('/api/jwt/generate').respond(200, responseData);
      generateJwtToken().then(function(data) {
        expect(data).to.deep.equal(responseData);
        done();
      }, done.bind(null, 'should resolve'));
      $httpBackend.flush();
    });

    it('should reject error response on failure', function(done) {
      $httpBackend.expectPOST('/api/jwt/generate').respond(500);
      generateJwtToken().then(done.bind(null, 'should reject'), function(err) {
        expect(err.status).to.equal(500);
        done();
      });
      $httpBackend.flush();
    });

  });

  describe('The jmapClientProvider service', function() {

    var $rootScope, $httpBackend, jmapClientProvider, jmap;

    function injectServices() {
      angular.mock.inject(function(_$rootScope_, _$httpBackend_, _jmapClientProvider_, _jmap_) {
        $rootScope = _$rootScope_;
        $httpBackend = _$httpBackend_;
        jmapClientProvider = _jmapClientProvider_;
        jmap = _jmap_;
      });
    }

    it('should return a rejected promise if jwt generation fails', function(done) {
      var error = new Error('error message');

      angular.mock.module(function($provide) {
        $provide.value('generateJwtToken', function() {
          return $q.reject(error);
        });
      });
      injectServices.bind(this)();

      jmapClientProvider.get().then(done.bind(null, 'should reject'), function(err) {
        expect(err.message).to.equal(error.message);

        done();
      });
      $rootScope.$digest();
    });

    it('should return a fulfilled promise if jwt generation succeed', function(done) {
      angular.mock.module(function($provide) {
        $provide.value('generateJwtToken', function() {
          return $q.when('expected jwt');
        });
      });
      config['linagora.esn.unifiedinbox.api'] = 'expected jmap api';
      injectServices.bind(this)();

      jmapClientProvider.get().then(function(client) {
        expect(client).to.be.an.instanceof(jmap.Client);
        expect(client.authToken).to.equal('Bearer expected jwt');
        expect(client.apiUrl).to.equal('expected jmap api');

        done();
      }, done.bind(null, 'should resolve'));
      $rootScope.$digest();
    });

  });

  describe('The withJmapClient factory', function() {

    var $rootScope, withJmapClient;
    var jmapClientProviderMock;

    beforeEach(function() {
      jmapClientProviderMock = {};
      angular.mock.module(function($provide) {
        $provide.value('jmapClientProvider', jmapClientProviderMock);
      });
      angular.mock.inject(function(_$rootScope_, _withJmapClient_) {
        withJmapClient = _withJmapClient_;
        $rootScope = _$rootScope_;
      });
    });

    it('should give the client in the callback when jmapClientProvider resolves', function(done) {
      var jmapClient = { send: angular.noop };
      jmapClientProviderMock.get = function() { return $q.when(jmapClient); };

      withJmapClient(function(client) {
        expect(client).to.deep.equal(jmapClient);

        done();
      });
      $rootScope.$digest();
    });

    it('should resolve the callback with a null instance and an error when jmapClient cannot be built', function(done) {
      jmapClientProviderMock.get = function() { return $q.reject(new Error()); };

      withJmapClient(function(client, err) {
        expect(client).to.equal(null);
        expect(err).to.be.an.instanceOf(Error);

        done();
      });
      $rootScope.$digest();
    });

    it('should reject if the callback promise rejects', function(done) {
      jmapClientProviderMock.get = function() { return $q.when({}); };
      var e = new Error('error message');
      withJmapClient(function() {
        return $q.reject(e);
      }).then(done.bind(null, 'should reject'), function(err) {
        expect(err.message).to.equal(e.message);

        done();
      });

      $rootScope.$digest();
    });

  });

  describe('The sendEmail service', function() {

    var $httpBackend, $rootScope, jmap, sendEmail, backgroundProcessorService, jmapClientMock;

    beforeEach(function() {
      jmapClientMock = {};

      angular.mock.module(function($provide) {
        $provide.value('withJmapClient', function(callback) {
          return callback(jmapClientMock);
        });
      });

      angular.mock.inject(function(_$httpBackend_, _$rootScope_, _jmap_, _sendEmail_, _backgroundProcessorService_) {
        $httpBackend = _$httpBackend_;
        $rootScope = _$rootScope_;
        jmap = _jmap_;
        sendEmail = _sendEmail_;
        backgroundProcessorService = _backgroundProcessorService_;
      });

    });

    it('should be called as a background task', function() {
      sinon.spy(backgroundProcessorService, 'add');
      $httpBackend.expectPOST('/unifiedinbox/api/inbox/sendemail').respond(200);

      sendEmail({});
      $httpBackend.flush();

      expect(backgroundProcessorService.add).to.have.been.calledOnce;
    });

    describe('Use SMTP', function() {

      beforeEach(function() {
        config['linagora.esn.unifiedinbox.isJmapSendingEnabled'] = false;
      });

      it('should use SMTP to send email when JMAP is not enabled to send email', function() {
        $httpBackend.expectPOST('/unifiedinbox/api/inbox/sendemail').respond(200);
        sendEmail({});
        $httpBackend.flush();
      });

      it('should resolve response on success', function(done) {
        var data = { key: 'data' };
        $httpBackend.expectPOST('/unifiedinbox/api/inbox/sendemail').respond(200, data);
        sendEmail({}).then(function(resp) {
          expect(resp.data).to.deep.equal(data);
          done();
        }, done.bind(null, 'should resolve'));
        $httpBackend.flush();
      });

      it('should reject error response on failure', function(done) {
        $httpBackend.expectPOST('/unifiedinbox/api/inbox/sendemail').respond(500);
        sendEmail({}).then(done.bind(null, 'should reject'), function(err) {
          expect(err.status).to.equal(500);
          done();
        });
        $httpBackend.flush();
      });

    });

    describe('Use JMAP', function() {
      beforeEach(function() {
        config['linagora.esn.unifiedinbox.isJmapSendingEnabled'] = true;
        config['linagora.esn.unifiedinbox.isSaveDraftBeforeSendingEnabled'] = true;

        jmapClientMock.saveAsDraft = function() {
          return $q.when({});
        };

        jmapClientMock.getMailboxWithRole = function() {
          return $q.when({});
        };

        jmapClientMock.moveMessage = function() {
          return $q.when({});
        };

      });

      it('should use JMAP to send email when JMAP is enabled to send email', function(done) {
        var email = { from: { email: 'A' }, to: [{ email: 'B' }] };
        var messageAck = { id: 'm123' };
        var outbox = { id: 't456' };

        jmapClientMock.saveAsDraft = function() {
          return $q.when(messageAck);
        };

        jmapClientMock.getMailboxWithRole = function(role) {
          expect(role).to.equal(jmap.MailboxRole.OUTBOX);
          return $q.when(outbox);
        };

        jmapClientMock.moveMessage = function(messageId, mailboxIds) {
          expect(messageId).to.equal(messageAck.id);
          expect(mailboxIds).to.deep.equal([outbox.id]);
        };

        sendEmail(email).then(done.bind(null, null), done.bind(null, 'should resolve'));
        $rootScope.$digest();
      });

      it('should reject if JMAP client fails to save email as draft', function(done) {
        var error = new Error('error message');
        jmapClientMock.saveAsDraft = function() {
          return $q.reject(error);
        };

        sendEmail({}).then(done.bind(null, 'should reject'), function(err) {
          expect(err.message).to.equal(error.message);
          done();
        });
        $rootScope.$digest();
      });

      it('should reject if JMAP client fails to get outbox mailbox', function(done) {
        var error = new Error('error message');
        jmapClientMock.getMailboxWithRole = function() {
          return $q.reject(error);
        };

        sendEmail({}).then(done.bind(null, 'should reject'), function(err) {
          expect(err.message).to.equal(error.message);
          done();
        });
        $rootScope.$digest();
      });

      it('should reject if JMAP client fails to move message to outbox mailbox', function(done) {
        var error = new Error('error message');
        jmapClientMock.moveMessage = function() {
          return $q.reject(error);
        };

        sendEmail({}).then(done.bind(null, 'should reject'), function(err) {
          expect(err.message).to.equal(error.message);
          done();
        });
        $rootScope.$digest();
      });

    });

    describe('Use JMAP but without saving a draft', function() {

      var email;

      beforeEach(function() {
        email = { to: [{ email: 'B' }] };
        config['linagora.esn.unifiedinbox.isJmapSendingEnabled'] = true;
        config['linagora.esn.unifiedinbox.isSaveDraftBeforeSendingEnabled'] = false;
      });

      it('should use JMAP to send email when JMAP is enabled to send email', function(done) {
        jmapClientMock.send = sinon.stub().returns($q.when('expected return'));

        sendEmail(email).then(function(returnedValue) {
          expect(jmapClientMock.send).to.have.been.calledWithMatch({ to: [{ email: 'B', name: '' }]});
          expect(returnedValue).to.equal('expected return');
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should reject if JMAP client send fails', function(done) {
        var error = new Error('error message');
        jmapClientMock.send = sinon.stub().returns($q.reject(error));

        sendEmail(email).then(function(returnedValue) {
        }).then(done.bind(null, 'should reject'), function(err) {
          expect(err).to.deep.equal(error);
          done();
        });

        $rootScope.$digest();
      });

    });

  });

  describe('The jmapHelper service', function() {

    var jmapHelper, jmap, emailBodyServiceMock;

    beforeEach(function() {
      angular.mock.module(function($provide) {
        $provide.value('emailBodyService', emailBodyServiceMock = { bodyProperty: 'htmlBody' });
      });

      angular.mock.inject(function(_jmapHelper_, _jmap_, session) {
        jmapHelper = _jmapHelper_;
        jmap = _jmap_;

        session.user = {
          name: 'Alice',
          preferredEmail: 'alice@domain'
        };
      });
    });

    describe('The toOutboundMessage fn', function() {

      it('should build and return new instance of jmap.OutboundMessage', function() {
        expect(jmapHelper.toOutboundMessage({}, {
          subject: 'expected subject',
          htmlBody: 'expected htmlBody',
          to: [{email: 'to@domain', name: 'to'}],
          cc: [{email: 'cc@domain', name: 'cc'}],
          bcc: [{email: 'bcc@domain', name: 'bcc'}]
        })).to.deep.equal(new jmap.OutboundMessage({}, {
          from: new jmap.EMailer({
            name: 'Alice',
            email: 'alice@domain'
          }),
          subject: 'expected subject',
          htmlBody: 'expected htmlBody',
          to: [{email: 'to@domain', name: 'to'}],
          cc: [{email: 'cc@domain', name: 'cc'}],
          bcc: [{email: 'bcc@domain', name: 'bcc'}]
        }));
      });

      it('should filter attachments with no blobId', function() {
        expect(jmapHelper.toOutboundMessage({}, {
          htmlBody: 'expected htmlBody',
          attachments: [{ blobId: '1' }, { blobId: '' }]
        })).to.deep.equal(new jmap.OutboundMessage({}, {
          from: new jmap.EMailer({
            name: 'Alice',
            email: 'alice@domain'
          }),
          htmlBody: 'expected htmlBody',
          to: [],
          cc: [],
          bcc: [],
          attachments: [new jmap.Attachment({}, '1')]
        }));
      });

      it('should include email.htmlBody when provided', function() {
        emailBodyServiceMock.bodyProperty = 'textBody';

        var message = jmapHelper.toOutboundMessage({}, {
          htmlBody: 'expected htmlBody',
          textBody: 'expected textBody'
        });

        expect(message.htmlBody).to.equal('expected htmlBody');
        expect(message.textBody).to.be.null;
      });

      it('should leverage emailBodyServiceMock.bodyProperty when emailState.htmlBody is undefined', function() {
        emailBodyServiceMock.bodyProperty = 'textBody';

        var message = jmapHelper.toOutboundMessage({}, {
          htmlBody: '',
          textBody: 'expected textBody'
        });

        expect(message.htmlBody).to.be.null;
        expect(message.textBody).to.equal('expected textBody');
      });
    });

  });

  describe('The emailSendingService factory', function() {
    var emailSendingService, email, $rootScope;

    beforeEach(function() {
      angular.mock.module(function($provide) {
        $provide.value('sendEmail', angular.noop);
      });
      angular.mock.inject(function(_emailSendingService_, _$rootScope_) {
        emailSendingService = _emailSendingService_;
        $rootScope = _$rootScope_;
      });
    });

    describe('The noRecipient function', function() {
      it('should return true when no recipient is provided', function() {
        email = {
          to: [],
          cc: [],
          bcc: []
        };
        expect(emailSendingService.noRecipient()).to.be.true;
        expect(emailSendingService.noRecipient({})).to.be.true;
        expect(emailSendingService.noRecipient(email)).to.be.true;
      });

      it('should return false when some recipients are provided', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [],
          bcc: []
        };
        expect(emailSendingService.noRecipient(email)).to.be.false;

        email = {
          to: [],
          cc: [{displayName: '1', email: '1@linagora.com'}],
          bcc: []
        };
        expect(emailSendingService.noRecipient(email)).to.be.false;
      });
    });

    describe('The emailsAreValid function', function() {
      it('should return false when some recipients emails are not valid', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '1', email: '1@linagora.com'}, {displayName: '3', email: '3linagora.com'}],
          bcc: []
        };
        expect(emailSendingService.emailsAreValid(email)).to.be.false;
      });

      it('should return true when all recipients emails are valid', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}]
        };
        expect(emailSendingService.emailsAreValid(email)).to.be.true;
      });
    });

    describe('The removeDuplicateRecipients function', function() {
      var expectedEmail;

      it('should return the same object when recipients emails are all different', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };
        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };
        emailSendingService.removeDuplicateRecipients(email);
        expect(expectedEmail).to.shallowDeepEqual(email);
      });

      it('should delete duplicated emails in the following priority: to => cc => bcc', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '4', email: '4@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };
        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '6', email: '6@linagora.com'}]
        };
        emailSendingService.removeDuplicateRecipients(email);
        expect(expectedEmail).to.shallowDeepEqual(email);

        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '1', email: '1@linagora.com'}, {displayName: '4', email: '4@linagora.com'}]
        };
        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: []
        };
        emailSendingService.removeDuplicateRecipients(email);
        expect(expectedEmail).to.shallowDeepEqual(email);
      });
    });

    describe('The prefixSubject function', function() {

      it('should prefix the subject with the required prefix if it does not already exist in the subject', function() {
        expect(emailSendingService.prefixSubject('subject', 'Re: ')).to.equal('Re: subject');
        expect(emailSendingService.prefixSubject('Re:subject', 'Re: ')).to.equal('Re: Re:subject');
      });

      it('should not prefix the subject with the required prefix if it exists in the subject', function() {
        expect(emailSendingService.prefixSubject('Re: subject', 'Re: ')).to.equal('Re: subject');
      });

      it('should ensure that the prefix is suffixed with a space', function() {
        expect(emailSendingService.prefixSubject('subject', 'Re:')).to.equal('Re: subject');
        expect(emailSendingService.prefixSubject('subject', 'Re: ')).to.equal('Re: subject');
      });

      it('should do nothing when subject/prefix is/are not provided', function() {
        expect(emailSendingService.prefixSubject(null, 'Re:')).to.equal(null);
        expect(emailSendingService.prefixSubject('subject', null)).to.equal('subject');
        expect(emailSendingService.prefixSubject(null, null)).to.equal(null);
      });
    });

    describe('The showReplyAllButton function', function() {
      var email;

      it('should return true when more than one recipient is provided', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };
        expect(emailSendingService.showReplyAllButton(email)).to.be.true;
      });
      it('should return false when one/zero recipient is provided', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [],
          bcc: []
        };
        expect(emailSendingService.showReplyAllButton(email)).to.be.false;
        email = {
        };
        expect(emailSendingService.showReplyAllButton(email)).to.be.false;
      });
    });

    describe('The getReplyAllRecipients function', function() {
      var email, sender, expectedEmail;
      it('should do nothing when email/sender is/are not provided', function() {
        expect(emailSendingService.getReplyAllRecipients(null, {})).to.be.undefined;
        expect(emailSendingService.getReplyAllRecipients({}, null)).to.be.undefined;
        expect(emailSendingService.getReplyAllRecipients(null, null)).to.be.undefined;
      });

      it('should: 1- add FROM to the TO field, 2- do not modify the recipient when the sender is not listed inside', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}, {displayName: '0', email: '0@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });

      it('should: 1- add FROM to the TO field, 2- remove the sender from the recipient object if listed in TO or CC', function() {
        email = {
          to: [{displayName: 'sender', email: 'sender@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '2', email: '2@linagora.com'}, {displayName: '0', email: '0@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);

        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: 'sender', email: 'sender@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}, {displayName: '0', email: '0@linagora.com'}],
          cc: [{displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });

      it('should not add FROM to the TO filed if it represents the sender', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: 'sender', email: 'sender@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });

      it('should not add FROM to the TO field if already there', function() {
        email = {
          to: [{ displayName: '1', email: '1@linagora.com' }, { displayName: '2', email: '2@linagora.com' }],
          from: { displayName: '1', email: '1@linagora.com' }
        };

        sender =  { displayName: 'sender', email: 'sender@linagora.com' };

        expectedEmail = {
          to: [{ displayName: '1', email: '1@linagora.com' }, { displayName: '2', email: '2@linagora.com' }],
          cc: [],
          bcc: []
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });

      it('should leverage the replyTo field instead of FROM (when provided)', function() {
        email = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'},
          replyTo: [{displayName: 'replyToEmail', email: 'replyToEmail@linagora.com'}]
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '1', email: '1@linagora.com'}, {displayName: '2', email: '2@linagora.com'}, {displayName: 'replyToEmail', email: 'replyToEmail@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });

      it('should not modify the BCC field even if the sender is listed inside', function() {
        email = {
          to: [{displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '2', email: '2@linagora.com'}, {displayName: '0', email: '0@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender).bcc).to.shallowDeepEqual(expectedEmail.bcc);

        sender =  {displayName: '5', email: '5@linagora.com'};
        expect(emailSendingService.getReplyAllRecipients(email, sender).bcc).to.shallowDeepEqual(expectedEmail.bcc);
      });

      it('should remove the sender from the recipient object (the sender could be an EMailer or the logged-in User)', function() {
        email = {
          to: [{displayName: 'sender', email: 'sender@linagora.com'}, {displayName: '2', email: '2@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}],
          from: {displayName: '0', email: '0@linagora.com'}
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        expectedEmail = {
          to: [{displayName: '2', email: '2@linagora.com'}, {displayName: '0', email: '0@linagora.com'}],
          cc: [{displayName: '3', email: '3@linagora.com'}, {displayName: '4', email: '4@linagora.com'}],
          bcc: [{displayName: '5', email: '5@linagora.com'}, {displayName: '6', email: '6@linagora.com'}]
        };

        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);

        sender =  {displayName: 'sender', preferredEmail: 'sender@linagora.com'};
        expect(emailSendingService.getReplyAllRecipients(email, sender)).to.shallowDeepEqual(expectedEmail);
      });
    });

    describe('The getReplyRecipients function', function() {
      var email, sender, expectedEmail;

      it('should do nothing when email is not provided', function() {
        expect(emailSendingService.getReplyRecipients(null)).to.be.undefined;
      });

      it('should reply to FROM if ReplyTo is not present', function() {
        email = {
          from: {displayName: '0', email: '0@linagora.com'}
        };

        expectedEmail = {
          to: [{displayName: '0', email: '0@linagora.com'}]
        };

        expect(emailSendingService.getReplyRecipients(email)).to.shallowDeepEqual(expectedEmail);
      });

      it('should reply to ReplyTo if ReplyTo is present', function() {
        email = {
          from: {displayName: '0', email: '0@linagora.com'},
          replyTo: [{displayName: 'replyto', email: 'replyto@linagora.com'}]
        };

        expectedEmail = {
          to: [{displayName: 'replyto', email: 'replyto@linagora.com'}]
        };

        expect(emailSendingService.getReplyRecipients(email)).to.shallowDeepEqual(expectedEmail);
      });

      it('should reply to ReplyTo if ReplyTo is present, filtering out unknown EMailers', function() {
        email = {
          from: {displayName: '0', email: '0@linagora.com'},
          replyTo: [{displayName: 'replyto', email: 'replyto@linagora.com'}, { email: '@' }, { name: 'second', email: 'second@linagora.com' }]
        };

        expectedEmail = {
          to: [{displayName: 'replyto', email: 'replyto@linagora.com'}, { name: 'second', email: 'second@linagora.com' }]
        };

        expect(emailSendingService.getReplyRecipients(email)).to.shallowDeepEqual(expectedEmail);
      });

    });

    describe('The createReplyAllEmailObject function', function() {
      var email, sender, expectedAnswer;

      it('should create a reply all email object, quoting the original message on desktop', function(done) {
        email = {
          from: {email: 'sender@linagora.com', name: 'linagora'},
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {displayName: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          subject: 'Re: my subject',
          quoted: email,
          quoteTemplate: 'default',
          isQuoting: true
        };

        emailSendingService.createReplyAllEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should create a reply all email object, not quoting the original message on mobile', function(done) {
        isMobile = true;
        email = {
          from: {email: 'sender@linagora.com', name: 'linagora'},
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {displayName: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          subject: 'Re: my subject',
          quoted: email,
          quoteTemplate: 'default',
          isQuoting: false
        };

        emailSendingService.createReplyAllEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should not include attachments in the replayAll email', function(done) {
        email = {
          from: {email: 'from@linagora.com', name: 'linagora'},
          attachments: [{attachment: 'A'}, {attachment: 'B'}]
        };

        sender =  {displayName: 'sender', email: 'sender@linagora.com'};

        emailSendingService.createReplyAllEmailObject(email, sender).then(function(email) {
          expect(email.attachments).to.be.undefined;
        }).then(done, done);

        $rootScope.$digest();
      });

    });

    describe('The createReplyEmailObject function', function() {
      var email, sender, expectedAnswer;

      it('should create a reply email object, quoting the original message on desktop', function(done) {
        email = {
          from: {email: 'from@linagora.com', name: 'linagora'},
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {displayName: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          to: [{email: 'from@linagora.com', name: 'linagora'}],
          subject: 'Re: my subject',
          quoted: email,
          quoteTemplate: 'default',
          isQuoting: true
        };

        emailSendingService.createReplyEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should create a reply email object, not quoting the original message on mobile', function(done) {
        isMobile = true;
        email = {
          from: {email: 'from@linagora.com', name: 'linagora'},
          to: [{displayName: '1', email: '1@linagora.com'}],
          cc: [{displayName: '2', email: '2@linagora.com'}],
          bcc: [{displayName: '3', email: '3@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {displayName: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          to: [{email: 'from@linagora.com', name: 'linagora'}],
          subject: 'Re: my subject',
          quoted: email,
          quoteTemplate: 'default',
          isQuoting: false
        };

        emailSendingService.createReplyEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should not include attachments in the replay email', function(done) {
        email = {
          attachments: [{attachment: 'A'}, {attachment: 'B'}]
        };

        emailSendingService.createReplyEmailObject(email, sender).then(function(email) {
          expect(email.attachments).to.be.undefined;
        }).then(done, done);

        $rootScope.$digest();
      });

    });

    describe('The createForwardEmailObject function', function(done) {
      var email, sender, expectedAnswer;

      it('should create a forward email object, quoting the original message on desktop', function() {
        email = {
          from: {email: 'from@linagora.com', name: 'from'},
          to: [{name: 'first', email: 'first@linagora.com'}, {name: 'second', email: 'second@linagora.com'}],
          cc: [{name: 'third', email: 'third@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {name: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          subject: 'Fw: my subject',
          htmlBody: '<p><br/></p>' +
          '<cite>' +
          '------- Forwarded message -------<br/>' +
          'Subject: my subject<br/>' +
          'Date: 12:00:00 14:00<br/>' +
          'From: from@linagora.com<br/>' +
          'To: first &lt;first@linagora.com&gt;, second &lt;second@linagora.com&gt;<br/>' +
          'CC: third &lt;third@linagora.com&gt;' +
          '</cite>' +
          '<blockquote><p>my body</p></blockquote>',
          quoted: email,
          quoteTemplate: 'forward',
          isQuoting: true
        };

        emailSendingService.createForwardEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should create a forward email object, not quoting the original message on mobile', function() {
        isMobile = true;
        email = {
          from: {email: 'from@linagora.com', name: 'from'},
          to: [{name: 'first', email: 'first@linagora.com'}, {name: 'second', email: 'second@linagora.com'}],
          cc: [{name: 'third', email: 'third@linagora.com'}],
          date: '12:00:00 14:00',
          subject: 'my subject',
          htmlBody: '<p>my body</p>'
        };
        sender =  {name: 'sender', email: 'sender@linagora.com'};
        expectedAnswer = {
          from: 'sender@linagora.com',
          subject: 'Fw: my subject',
          quoted: email,
          quoteTemplate: 'forward',
          isQuoting: false
        };

        emailSendingService.createForwardEmailObject(email, sender).then(function(email) {
          expect(email).to.shallowDeepEqual(expectedAnswer);
        }).then(done, done);

        $rootScope.$digest();
      });

      it('should include attachments in the forwarded email', function() {
        email = {
          attachments: [{attachment: 'A'}, {attachment: 'B'}]
        };

        emailSendingService.createForwardEmailObject(email, sender).then(function(email) {
          expect(email.attachments).to.shallowDeepEqual([{attachment: 'A'}, {attachment: 'B'}]);
        }).then(done, done);

        $rootScope.$digest();
      });

    });
  });

  describe('The draftService service', function() {

    var draftService, session, notificationFactory, jmap, jmapClient, emailBodyService, $rootScope;

    beforeEach(module(function($provide) {
      jmapClient = {};
      notificationFactory = {
        strongInfo: sinon.stub().returns({ close: angular.noop }),
        weakError: sinon.spy(),
        weakSuccess: sinon.spy()
      };
      emailBodyService = {
        bodyProperty: 'htmlBody'
      };

      $provide.value('notificationFactory', notificationFactory);
      $provide.constant('withJmapClient', function(callback) {
        return callback(jmapClient);
      });
      $provide.value('emailBodyService', emailBodyService);
    }));

    beforeEach(inject(function(_draftService_, _session_, _$rootScope_, _jmap_) {
      draftService = _draftService_;
      session = _session_;
      $rootScope = _$rootScope_;
      jmap = _jmap_;
    }));

    describe('The needToBeSaved method', function() {

      it('should return false if original and new are both undefined object', function() {
        var draft = draftService.startDraft(undefined);
        expect(draft.needToBeSaved(undefined)).to.equal(false);
      });

      it('should return false if original and new are both empty object', function() {
        var draft = draftService.startDraft({});
        expect(draft.needToBeSaved({})).to.equal(false);
      });

      it('should look for differences after having copying original', function() {
        var content = {subject: 'yo'};

        var draft = draftService.startDraft(content);
        content.subject = 'lo';

        expect(draft.needToBeSaved(content)).to.equal(true);
      });

      it('should return false if original and new are equal', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to@domain'}],
          cc: [{email: 'cc@domain'}],
          bcc: [{email: 'bcc@domain'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to@domain'}],
          cc: [{email: 'cc@domain'}],
          bcc: [{email: 'bcc@domain'}]
        })).to.equal(false);
      });

      it('should return false if only order changes', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to1@domain'}, {email: 'to2@domain'}],
          cc: [{email: 'cc1@domain'}, {email: 'cc2@domain'}],
          bcc: [{email: 'bcc1@domain'}, {email: 'bcc2@domain'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to2@domain'}, {email: 'to1@domain'}],
          cc: [{email: 'cc2@domain'}, {email: 'cc1@domain'}],
          bcc: [{email: 'bcc1@domain'}, {email: 'bcc2@domain'}]
        })).to.equal(false);
      });

      it('should return false if only name has changed', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to@domain', name:'before'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'to@domain', name:'after'}]
        })).to.equal(false);
      });

      it('should return true if original has one more field', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text'
        });
        expect(draft.needToBeSaved({
          subject: 'yo'
        })).to.equal(true);
      });

      it('should return true if new state has one more field', function() {
        var draft = draftService.startDraft({
          subject: 'yo'
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text'
        })).to.equal(true);
      });

      it('should return true if original has difference into recipients only', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: []
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'second@domain'}]
        })).to.equal(true);
      });

      it('should return true if new has difference into to recipients only', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'first@domain'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: [{email: 'second@domain'}]
        })).to.equal(true);
      });

      it('should return true if an attachment is added', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text'
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1'}]
        })).to.equal(true);
      });

      it('should return true if new has difference into attachments', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1'}, {blobId: '2'}]
        })).to.equal(true);
      });

      it('should not compare attributes that are not definied in ATTACHMENTS_ATTRIBUTES', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1', name: 'name 1'}, {blobId: '2', name: 'name 2'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1', name: 'name 1'}, {blobId: '2', name: 'name 2', notTested: 'notTested'}]
        })).to.equal(false);
      });

      it('should compare attributes that are definied in ATTACHMENTS_ATTRIBUTES', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1', name: 'name 1'}, {blobId: '2', name: 'name 2'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          attachments: [{blobId: '1', name: 'name 1'}, {blobId: '2', name: 'name 2', size: 'new size'}]
        })).to.equal(true);
      });

      it('should return true if new has difference into cc recipients only', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          cc: [{email: 'first@domain'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          cc: [{email: 'second@domain'}]
        })).to.equal(true);
      });

      it('should return true if new has difference into bcc recipients only', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          bcc: [{email: 'first@domain'}]
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          bcc: [{email: 'second@domain'}]
        })).to.equal(true);
      });

      it('should return false if one has empty subject and other one has undefined', function() {
        var draft = draftService.startDraft({
          subject: '',
          htmlBody: 'text'
        });
        expect(draft.needToBeSaved({
          subject: undefined,
          htmlBody: 'text'
        })).to.equal(false);

        var draft2 = draftService.startDraft({
          subject: undefined,
          htmlBody: 'text'
        });
        expect(draft2.needToBeSaved({
          subject: '',
          htmlBody: 'text'
        })).to.equal(false);
      });

      it('should return false if one has space only subject and other one has undefined', function() {
        var draft = draftService.startDraft({
          subject: ' ',
          htmlBody: 'text'
        });
        expect(draft.needToBeSaved({
          subject: undefined,
          htmlBody: 'text'
        })).to.equal(false);

        var draft2 = draftService.startDraft({
          subject: undefined,
          htmlBody: 'text'
        });
        expect(draft2.needToBeSaved({
          subject: ' ',
          htmlBody: 'text'
        })).to.equal(false);
      });

      it('should return false if one has empty body and other one has undefined', function() {
        var draft = draftService.startDraft({
          subject: 'subject',
          htmlBody: undefined
        });
        expect(draft.needToBeSaved({
          subject: 'subject',
          htmlBody: ''
        })).to.equal(false);

        var draft2 = draftService.startDraft({
          subject: 'subject',
          htmlBody: ''
        });
        expect(draft2.needToBeSaved({
          subject: 'subject',
          htmlBody: undefined
        })).to.equal(false);
      });

      it('should return false if one has space only body and other one has undefined', function() {
        var draft = draftService.startDraft({
          subject: 'subject',
          htmlBody: undefined
        });
        expect(draft.needToBeSaved({
          subject: 'subject',
          htmlBody: ' '
        })).to.equal(false);

        var draft2 = draftService.startDraft({
          subject: 'subject',
          htmlBody: ' '
        });
        expect(draft2.needToBeSaved({
          subject: 'subject',
          htmlBody: undefined
        })).to.equal(false);
      });

      it('should return false if original has empty recipients property', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text',
          to: []
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text'
        })).to.equal(false);
      });

      it('should return false if new has empty recipients property', function() {
        var draft = draftService.startDraft({
          subject: 'yo',
          htmlBody: 'text'
        });
        expect(draft.needToBeSaved({
          subject: 'yo',
          htmlBody: 'text',
          to: []
        })).to.equal(false);
      });

      it('should return false if composing an email from scratch on mobile, and body is empty', function() {
        emailBodyService.bodyProperty = 'textBody';

        expect(draftService.startDraft({
          to: [{ email: 'a@a.com' }],
          subject: 'subject'
        }).needToBeSaved({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          textBody: ''
        })).to.equal(false);
      });

      it('should return false if composing an email from an existing draft on mobile, and body has not changed', function() {
        emailBodyService.bodyProperty = 'textBody';

        expect(draftService.startDraft({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          textBody: 'body'
        }).needToBeSaved({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          textBody: 'body'
        })).to.equal(false);
      });

      it('should return false if composing an email from scratch on desktop, and body is empty', function() {
        expect(draftService.startDraft({
          to: [{ email: 'a@a.com' }],
          subject: 'subject'
        }).needToBeSaved({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          htmlBody: ''
        })).to.equal(false);
      });

      it('should return false if composing an email from an existing draft on desktop, and body is empty', function() {
        expect(draftService.startDraft({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          htmlBody: '<p>body</p>'
        }).needToBeSaved({
          to: [{ email: 'a@a.com' }],
          subject: 'subject',
          htmlBody: '<p>body</p>'
        })).to.equal(false);
      });

    });

    describe('The save method', function() {

      it('should do nothing and return rejected promise if needToBeSaved returns false', function(done) {
        jmapClient.saveAsDraft = sinon.spy();
        var draft = draftService.startDraft({});
        draft.needToBeSaved = function() {return false;};

        draft.save({}).catch(function() {
          expect(jmapClient.saveAsDraft).to.not.have.been.called;
          done();
        });

        $rootScope.$digest();
      });

      it('should call saveAsDraft if needToBeSaved returns true', function(done) {
        jmapClient.saveAsDraft = sinon.stub().returns($q.when({}));
        var draft = draftService.startDraft({});
        draft.needToBeSaved = function() {return true;};

        draft.save({to: []}).then(function() {
          expect(jmapClient.saveAsDraft).to.have.been.called;
          done();
        });

        $rootScope.$digest();
      });

      it('should call saveAsDraft with OutboundMessage filled with properties', function() {
        jmapClient.saveAsDraft = sinon.stub().returns($q.when({}));
        session.user = {preferredEmail: 'yo@lo', name: 'me'};

        draftService.startDraft({}).save({
          subject: 'expected subject',
          htmlBody: 'expected htmlBody',
          to: [{email: 'to@domain', name: 'to'}],
          cc: [{email: 'cc@domain', name: 'cc'}],
          bcc: [{email: 'bcc@domain', name: 'bcc'}]
        });
        $rootScope.$digest();

        expect(jmapClient.saveAsDraft).to.have.been.calledWithMatch(
          sinon.match({
            from: {email: 'yo@lo', name: 'me'},
            subject: 'expected subject',
            htmlBody: 'expected htmlBody',
            to: [{email: 'to@domain', name: 'to'}],
            cc: [{email: 'cc@domain', name: 'cc'}],
            bcc: [{email: 'bcc@domain', name: 'bcc'}]
          }));
      });

      it('should map all recipients to name-email tuple', function() {
        jmapClient.saveAsDraft = sinon.stub().returns($q.when({}));
        session.user = {preferredEmail: 'yo@lo', name: 'me'};

        draftService.startDraft({}).save({
          subject: 'expected subject',
          htmlBody: 'expected htmlBody',
          to: [{email: 'to@domain', name: 'to', other: 'value'}],
          cc: [{email: 'cc@domain', name: 'cc'}, {email: 'cc2@domain', other: 'value', name: 'cc2'}]
        });
        $rootScope.$digest();

        expect(jmapClient.saveAsDraft).to.have.been.calledWithMatch(
          sinon.match({
            from: {email: 'yo@lo', name: 'me'},
            subject: 'expected subject',
            htmlBody: 'expected htmlBody',
            to: [{email: 'to@domain', name: 'to'}],
            cc: [{email: 'cc@domain', name: 'cc'}, {email: 'cc2@domain', name: 'cc2'}]
          }));
      });

      it('should notify when has saved successfully', function() {
        jmapClient.saveAsDraft = function() {return $q.when({});};

        var draft = draftService.startDraft({});
        draft.needToBeSaved = function() {return true;};

        draft.save({to: []});

        $rootScope.$digest();
        expect(notificationFactory.strongInfo).to.have.been.calledWith('', 'Saving your email as draft in progress...');
        expect(notificationFactory.weakSuccess).to.have.been.calledWithExactly('', 'Saving your email as draft succeeded');
      });

      it('should notify when has not saved successfully', function(done) {
        var err = {message: 'rejected with err'};
        jmapClient.saveAsDraft = function() {return $q.reject(err);};

        var draft = draftService.startDraft({});
        draft.needToBeSaved = function() {return true;};

        draft.save({to: []}).catch(function(error) {
          expect(notificationFactory.strongInfo).to.have.been.calledWith('', 'Saving your email as draft in progress...');
          expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Saving your email as draft failed');
          expect(error).to.deep.equal(err);
          done();
        });

        $rootScope.$digest();
      });

    });

    describe('The destroy method', function() {

      it('should do nothing when the draft has been created from an object', function(done) {
        draftService.startDraft({}).destroy().then(done);

        $rootScope.$digest();
      });

      it('should call client.destroyMessage when the draft has an ID', function() {
        jmapClient.destroyMessage = sinon.stub().returns($q.when());

        draftService.startDraft({
          id: 'the id',
          htmlBody: 'Body'
        }).destroy();

        $rootScope.$digest();
        expect(jmapClient.destroyMessage).to.have.been.calledWith('the id');
      });

    });

  });

  describe('The newComposerService ', function() {

    var $rootScope, $state, $timeout, newComposerService, deviceDetector, boxOverlayOpener;

    beforeEach(module(function($provide) {
      $provide.value('withJmapClient', function(callback) {
        return callback({
          getMessages: function() {
            return $q.when([{ id: 'id' }]);
          }
        }, { url: 'http://jmap' });
      });
    }));

    beforeEach(inject(function(_$rootScope_, _$state_, _$timeout_, _newComposerService_, _deviceDetector_, _boxOverlayOpener_) {
      $rootScope = _$rootScope_;
      newComposerService = _newComposerService_;
      deviceDetector = _deviceDetector_;
      $state = _$state_;
      $timeout = _$timeout_;
      boxOverlayOpener = _boxOverlayOpener_;
    }));

    beforeEach(function() {
      $state.current = {
        name: 'stateName'
      };
      $state.params = 'stateParams';
      $state.go = sinon.spy();
    });

    afterEach(function() {
      $('.box-overlay-open').remove();
    });

    describe('The "open" method', function() {

      it('should delegate to deviceDetector to know if the device is mobile or not', function(done) {
        deviceDetector.isMobile = done;
        newComposerService.open();
      });

      it('should update the location if deviceDetector returns true', function() {
        deviceDetector.isMobile = sinon.stub().returns(true);

        newComposerService.open();
        $timeout.flush();

        expect($state.go).to.have.been.calledWith('unifiedinbox.compose', {
          email: undefined,
          compositionOptions: undefined,
          previousState: { name: 'stateName', params: 'stateParams' }
        });
      });

      it('should delegate to boxOverlayOpener if deviceDetector returns false', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);
        boxOverlayOpener.open = sinon.spy();

        newComposerService.open();

        expect(boxOverlayOpener.open).to.have.been.calledWithMatch({
          title: 'Compose an email',
          templateUrl: '/unifiedinbox/views/composer/box-compose.html'
        });
      });

    });

    describe('The "openDraft" method', function() {

      it('should delegate to deviceDetector to know if device is mobile or not', function(done) {
        deviceDetector.isMobile = done;

        newComposerService.openDraft('id');
        $rootScope.$digest();
      });

      it('should update the location with the email id if deviceDetector returns true', function() {
        deviceDetector.isMobile = sinon.stub().returns(true);
        $state.go = sinon.spy();

        newComposerService.openDraft('id');
        $rootScope.$digest();

        expect($state.go).to.have.been.calledWith('unifiedinbox.compose', {
          email: { id: 'id' },
          compositionOptions: undefined,
          previousState: { name: 'stateName', params: 'stateParams' }
        });
      });

      it('should delegate to boxOverlayOpener if deviceDetector returns false', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);
        boxOverlayOpener.open = sinon.spy();

        newComposerService.openDraft('id');
        $rootScope.$digest();

        expect(boxOverlayOpener.open).to.have.been.calledWith({
          id: 'id',
          title: 'Continue your draft',
          templateUrl: '/unifiedinbox/views/composer/box-compose.html',
          email:  { id: 'id' },
          compositionOptions: undefined
        });
      });

      it('should not open twice the same draft on desktop', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);

        newComposerService.openDraft('id');
        newComposerService.openDraft('id');
        $rootScope.$digest();

        expect($('.box-overlay-open').length).to.equal(1);
      });

    });

    describe('The "openEmailCustomTitle" method', function() {

      it('should delegate to deviceDetector to know if the device is mobile', function(done) {
        deviceDetector.isMobile = done;
        newComposerService.open({id: 'value'}, 'title');
      });

      it('should update the location with the email id if deviceDetector returns true', function() {
        deviceDetector.isMobile = sinon.stub().returns(true);

        newComposerService.open({expected: 'field'}, 'title');
        $timeout.flush();

        expect($state.go).to.have.been.calledWith('unifiedinbox.compose', {
          email: {expected: 'field'},
          compositionOptions: undefined,
          previousState: { name: 'stateName', params: 'stateParams' }});
      });

      it('should delegate to boxOverlayOpener if deviceDetector returns false', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);
        boxOverlayOpener.open = sinon.spy();

        newComposerService.open({ id: '1234', subject: 'object' }, 'title');

        expect(boxOverlayOpener.open).to.have.been.calledWith({
          id: '1234',
          title: 'title',
          templateUrl: '/unifiedinbox/views/composer/box-compose.html',
          email: { id: '1234', subject: 'object' },
          compositionOptions: undefined
        });
      });

      it('should use the default title if none given', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);
        boxOverlayOpener.open = sinon.spy();

        newComposerService.open({ id: '1234', subject: 'object' });

        expect(boxOverlayOpener.open).to.have.been.calledWith({
          id: '1234',
          title: 'Compose an email',
          templateUrl: '/unifiedinbox/views/composer/box-compose.html',
          email: { id: '1234', subject: 'object' },
          compositionOptions: undefined
        });
      });

      it('should forward the compositionOptions when "open" is called and is on mobile', function() {
        deviceDetector.isMobile = sinon.stub().returns(true);

        newComposerService.open({expected: 'field'}, 'title', {expected: 'options'});
        $timeout.flush();

        expect($state.go).to.have.been.calledWith('unifiedinbox.compose', {
          email: {expected: 'field'},
          compositionOptions: {expected: 'options'},
          previousState: { name: 'stateName', params: 'stateParams' }});
      });

      it('should forward the compositionOptions when "open" is called and is not on mobile', function() {
        deviceDetector.isMobile = sinon.stub().returns(false);
        boxOverlayOpener.open = sinon.spy();

        newComposerService.open({id: '1234', subject: 'object'}, 'title', {expected: 'options'});

        expect(boxOverlayOpener.open).to.have.been.calledWith({
          id: '1234',
          title: 'title',
          templateUrl: '/unifiedinbox/views/composer/box-compose.html',
          email: {id: '1234', subject: 'object'},
          compositionOptions: {expected: 'options'}
        });
      });

    });

  });

  describe('The Composition factory', function() {

    var Composition, draftService, emailSendingService, session, $timeout, Offline,
        notificationFactory, closeNotificationSpy, notificationTitle, notificationText,
        jmap, jmapClient, firstSaveAck, $rootScope, newComposerService,
        notifyOfGracedRequest, graceRequestResult;

    beforeEach(module(function($provide) {
      jmapClient = {
        destroyMessage: sinon.spy(function() { return $q.when(); }),
        saveAsDraft: sinon.spy(function() {
          return $q.when(firstSaveAck = new jmap.CreateMessageAck(jmapClient, {
            id: 'expected id',
            blobId: 'any',
            size: 5
          }));
        })
      };

      graceRequestResult = {
        cancelled: true,
        success: sinon.spy()
      };

      $provide.value('withJmapClient', function(callback) {
        return callback(jmapClient);
      });
      $provide.value('notifyOfGracedRequest', notifyOfGracedRequest = sinon.spy(function() {
        return {promise: $q.when(graceRequestResult)};
      }));
    }));

    beforeEach(inject(function(_draftService_, _notificationFactory_, _session_, _Offline_,
         _Composition_, _emailSendingService_, _$timeout_, _jmap_, _$rootScope_, _newComposerService_) {
      draftService = _draftService_;
      notificationFactory = _notificationFactory_;
      session = _session_;
      Offline = _Offline_;
      Composition = _Composition_;
      emailSendingService = _emailSendingService_;
      $timeout = _$timeout_;
      jmap = _jmap_;
      $rootScope = _$rootScope_;
      newComposerService = _newComposerService_;

      Offline.state = 'up';
      notificationTitle = '';
      notificationText = '';

      emailSendingService.sendEmail = sinon.stub().returns($q.when());
      closeNotificationSpy = sinon.spy();

      notificationFactory.weakSuccess = function(callTitle, callText) {
        notificationTitle = callTitle;
        notificationText = callText;
      };

      notificationFactory.weakError = function(callTitle, callText) {
        notificationTitle = callTitle;
        notificationText = callText;
      };

      notificationFactory.notify = function() {
        notificationTitle = 'Info';
        notificationText = 'Sending';
        return {
          close: closeNotificationSpy
        };
      };
    }));

    it('should create empty recipient array when instantiated with none', function() {
      var result = new Composition({}).getEmail();

      expect(result).to.deep.equal({
        to: [],
        cc: [],
        bcc: []
      });
    });

    it('should start a draft when instantiated', function() {
      draftService.startDraft = sinon.spy();

      new Composition({obj: 'expected'});

      expect(draftService.startDraft).to.have.been
        .calledWith({ obj: 'expected', bcc: [], cc: [], to: [] });
    });

    function expectEmailAfterSaveAsDraft(email, returnedMessage) {
      email.id = 'expected id';

      expect(returnedMessage).to.deep.equal(email);
    }

    function saveDraftTest(compositionMethod, done) {
      var composition = new Composition({});
      composition.email.htmlBody = 'modified';
      composition.email.to.push({email: '1@linagora.com'});

      composition[compositionMethod]().then(function(message) {
        expectEmailAfterSaveAsDraft(composition.email, message);
        expect(jmapClient.saveAsDraft.getCall(0).args[0]).to.shallowDeepEqual({
          htmlBody: 'modified',
          to: [{email: '1@linagora.com'}],
          bcc: [], cc: []
        });
      }).then(done, done);
      $timeout.flush();
    }

    it('should save the draft when saveDraft is called', function(done) {
      saveDraftTest('saveDraft', done);
    });

    it('should save the draft silently when saveDraftSilently is called', function(done) {
      saveDraftTest('saveDraftSilently', done);
    });

    it('should renew the original jmap message with the ack id when saveDraft is called', function(done) {
      var message = new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {});

      var composition = new Composition(message);
      composition.email.htmlBody = 'new content';

      composition.saveDraft().then(function() {
        expect(jmapClient.destroyMessage).to.have.been.calledWith('not expected id');
        expect(composition.draft.originalEmailState.id).to.equal('expected id');
      }).then(done, done);

      $timeout.flush();
    });

    it('should not save incomplete attachments in the drafts', function(done) {
      var composition = new Composition(new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1']));
      composition.email.attachments = [
        { blobId: '1', upload: { promise: $q.when() } },
        { blobId: '', upload: { promise: $q.when() } },
        { blobId: '2', upload: { promise: $q.when() } },
        { blobId: '', upload: { promise: $q.when() } }
      ];

      composition.saveDraft().then(function() {
        expect(jmapClient.saveAsDraft).to.have.been.calledWith(sinon.match({
          attachments: [new jmap.Attachment(jmapClient, '1'), new jmap.Attachment(jmapClient, '2')]
        }));
      }).then(done, done);

      $timeout.flush();
    });

    it('should renew the original jmap message with the second ack id when saveDraft is called twice, after the debouce delay', function(done) {
      var message = new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {});
      message.destroy = sinon.stub().returns($q.when());
      var secondSaveAck = new jmap.CreateMessageAck(jmapClient, {
        id: 'another id',
        blobId: 'any',
        size: 5
      });

      var composition = new Composition(message);
      composition.email.htmlBody = 'new content';

      composition.saveDraft().then(function() {
        composition.email.htmlBody = 'content modified';
        jmapClient.saveAsDraft = sinon.stub().returns($q.when(secondSaveAck));
      });
      $timeout.flush();

      composition.saveDraft().then(function() {
        expect(jmapClient.destroyMessage).to.have.been.calledWith('expected id');
        expect(composition.draft.originalEmailState.id).to.equal('another id');
        expect(composition.draft.originalEmailState.htmlBody).to.equal('content modified');
      }).then(done, done);
      $timeout.flush();
    });

    it('should debouce multiple calls to saveDraftSilently', function(done) {
      var message = new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {});

      var composition = new Composition(message);

      composition.email.htmlBody = 'content1';
      composition.saveDraftSilently();

      composition.email.htmlBody = 'content2';
      composition.saveDraftSilently();

      composition.email.htmlBody = 'content3';
      composition.saveDraftSilently().then(function() {
        expect(jmapClient.destroyMessage).to.have.been.calledWith('not expected id');
        expect(jmapClient.saveAsDraft).to.have.been.calledOnce;
        expect(composition.draft.originalEmailState.htmlBody).to.equal('content3');
      }).then(done, done);
      $timeout.flush();
    });

    it('should update the original message in the composition, with the email state used to save the draft', function(done) {
      var message = new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {});
      message.destroy = sinon.stub().returns($q.when());

      var composition = new Composition(message);
      composition.email.htmlBody = 'saving body';
      composition.email.to = [{displayName: '1', email: 'saving@domain.org'}];

      jmapClient.saveAsDraft = sinon.spy(function() {
        composition.email.htmlBody = 'modified body since save has been called';
        composition.email.to.push({email: 'modified@domain.org'});

        return $q.when(firstSaveAck);
      });

      composition.saveDraft().then(function() {
        expect(composition.draft.originalEmailState.id).to.equal('expected id');
        expect(composition.draft.originalEmailState.htmlBody).to.equal('saving body');
        expect(composition.draft.originalEmailState.to).to.shallowDeepEqual([{email: 'saving@domain.org'}]);
      }).then(done, done);

      $timeout.flush();
    });

    it('"saveDraft" should cancel a delayed draft save', function(done) {
      var composition = new Composition(new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {}));
      composition.email.subject = 'subject';

      jmapClient.saveAsDraft = sinon.spy(function() {
        return $q.when(firstSaveAck);
      });

      composition.saveDraftSilently();
      composition.saveDraft().then(function() {
        expect(jmapClient.saveAsDraft).to.have.been.calledOnce;

        done();
      });

      $timeout.flush();
    });

    it('"canBeSentOrNotify" fn should returns false when the email has no recipient', function() {
      var email = {
        to: [],
        cc: [],
        bcc: []
      };

      var result = new Composition(email).canBeSentOrNotify();

      expect(result).to.equal(false);
      expect(notificationTitle).to.equal('Note');
      expect(notificationText).to.equal('Your email should have at least one recipient');
    });

    it('"canBeSentOrNotify" fn should returns false when the network connection is down', function() {
      Offline.state = 'down';
      var email = {
        to: [{email: '1@linagora.com'}],
        cc: [],
        bcc: []
      };

      var result = new Composition(email).canBeSentOrNotify();

      expect(result).to.equal(false);
      expect(notificationTitle).to.equal('Note');
      expect(notificationText).to.equal('Your device loses its Internet connection. Try later!');
    });

    it('"send" fn should successfully send an email even if only bcc is used', function() {
      var email = {
        destroy: angular.noop,
        to: [],
        cc: [],
        bcc: [{displayName: '1', email: '1@linagora.com'}]
      };

      new Composition(email).send();
      $timeout.flush();

      expect(emailSendingService.sendEmail).to.have.been.calledOnce;
    });

    it('"send" fn should not try to destroy the original message, when it is not a jmap.Message', function() {
      var message = {
        destroy: sinon.spy(),
        to: [{displayName: '1', email: '1@linagora.com'}],
        type: 'is not jmap.Message as expected'
      };

      new Composition(message).send();
      $timeout.flush();

      expect(message.destroy).to.have.not.been.called;
    });

    it('"send" fn should destroy the original draft, when it is a jmap.Message', function() {
      var message = new jmap.Message(null, 'id', 'threadId', ['box1'], {
        to: [{displayName: '1', email: '1@linagora.com'}]
      });

      new Composition(message).send();
      $timeout.flush();

      expect(jmapClient.destroyMessage).to.have.been.calledWith('id');
    });

    it('"send" fn should quote the original email if current email is not already quoting', function() {
      new Composition({
        to: [{ email: 'A@A.com' }],
        quoteTemplate: 'default',
        quoted: {
          from: {
            name: 'test',
            email: 'test@open-paas.org'
          },
          subject: 'Heya',
          date: '2015-08-21T00:10:00Z',
          htmlBody: '<p>HtmlBody</p>'
        }
      }).send();
      $rootScope.$digest();

      expect(emailSendingService.sendEmail).to.have.been.calledWith(sinon.match({
        htmlBody: '<pre></pre><br/><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote><p>HtmlBody</p></blockquote>'
      }));
    });

    it('"send" fn should not quote the original email if current email is already quoting', function() {
      new Composition({
        to: [{ email: 'A@A.com' }],
        quoteTemplate: 'default',
        textBody: 'Body',
        isQuoting: true,
        quoted: {
          from: {
            name: 'test',
            email: 'test@open-paas.org'
          },
          subject: 'Heya',
          date: '2015-08-21T00:10:00Z',
          htmlBody: '<p>HtmlBody</p>'
        }
      }).send();
      $rootScope.$digest();

      expect(emailSendingService.sendEmail).to.have.been.calledWith(sinon.match({
        textBody: 'Body',
        htmlBody: undefined
      }));
    });

    it('"send" fn should not quote the original email if there is no original email', function() {
      new Composition({
        to: [{ email: 'A@A.com' }],
        textBody: 'Body'
      }).send();
      $rootScope.$digest();

      expect(emailSendingService.sendEmail).to.have.been.calledWith(sinon.match({
        textBody: 'Body',
        htmlBody: undefined
      }));
    });

    it('"send" should cancel a delayed draft save', function(done) {
      var composition = new Composition(new jmap.Message(jmapClient, 'not expected id', 'threadId', ['box1'], {}));
      composition.email.subject = 'subject';

      jmapClient.saveAsDraft = sinon.spy();

      composition.saveDraftSilently();
      composition.send().then(function() {
        expect(emailSendingService.sendEmail).to.have.been.calledOnce;
        expect(jmapClient.saveAsDraft).to.have.not.been.calledWith();

        done();
      });

      $timeout.flush();
    });

    describe('The "destroyDraft" function', function() {

      it('should generate expected notification when called', function(done) {
        new Composition({subject: 'a subject'}).destroyDraft().then(function() {
          expect(notifyOfGracedRequest).to.have.been.calledWith('This draft has been discarded', 'Reopen');
        }).then(done, done);

        $timeout.flush();
      });

      it('should reopen the composer with the expected email when the grace period is cancelled', function(done) {
        var expectedEmail = { to: ['to@to'], cc: [], bcc: [], subject: 'expected subject', htmlBody: 'expected body' };
        newComposerService.open = sinon.spy();

        new Composition(expectedEmail).destroyDraft().then(function() {
          expect(newComposerService.open).to.have.been.calledWith(expectedEmail, 'Resume message composition');
        }).then(done, done);

        $timeout.flush();
      });

      it('should perform draft saving when the composition has been modified, then restored, then saved', function(done) {
        var modifyingEmail = { to: [], cc: [], bcc: [], subject: 'original subject', htmlBody: '' };
        var expectedDraft = draftService.startDraft(angular.copy(modifyingEmail));
        newComposerService.open = sinon.spy();

        var composition = new Composition(modifyingEmail);
        composition.email.subject = modifyingEmail.subject = 'modified subject';

        composition.destroyDraft().then(function() {
          expect(newComposerService.open).to.have.been.calledWith(modifyingEmail, 'Resume message composition', {
            fromDraft: expectedDraft
          });
        }).then(done, done);

        $timeout.flush();
      });

      it('should call "success" on the notification to close it when the grace period is cancelled', function(done) {
        new Composition().destroyDraft().then(function() {
          expect(graceRequestResult.success).to.have.been.calledOnce;
        }).then(done, done);

        $timeout.flush();
      });

      it('should delete the original draft when the grace period is not cancelled', function(done) {
        var message = new jmap.Message(jmapClient, 123, 'threadId', ['box1'], {});
        graceRequestResult.cancelled = false;

        new Composition(message).destroyDraft().then(function() {
          expect(jmapClient.destroyMessage).to.have.been.calledWith(123);
        }).then(done, done);

        $timeout.flush();
      });

      it('should cancel the delayed save request', function() {
        var composition = new Composition();
        composition.email.htmlBody = 'content to save';

        composition.saveDraftSilently();
        composition.destroyDraft();

        $timeout.flush();
        expect(jmapClient.saveAsDraft).to.have.not.been.called;
      });

    });

  });

  describe('The emailBodyService factory', function() {

    var emailBodyService, $rootScope, _, isMobile;

    beforeEach(module(function($provide) {
      isMobile = false;

      $provide.value('deviceDetector', {
        isMobile: function() { return isMobile; }
      });
    }));

    beforeEach(inject(function(_emailBodyService_, _$rootScope_, ___, $templateCache) {
      emailBodyService = _emailBodyService_;
      $rootScope = _$rootScope_;
      _ = ___;

      $templateCache.put('/unifiedinbox/views/partials/quotes/default.txt', 'On {{ email.date | date:dateFormat:tz }} from {{ email.from.email }}: {{ email.textBody }}');
      $templateCache.put('/unifiedinbox/views/partials/quotes/forward.txt',
        '------- Forwarded message ------- ' +
        'Subject: {{ email.subject }} ' +
        'Date: {{ email.date | date:dateFormat:tz }} ' +
        '{{ email.to | emailerList:"To: "}} ' +
        '{{ email.cc | emailerList:"CC: "}} ' +
        '{{ email.textBody }}');
    }));

    describe('The quote function', function() {

      var email = {
        from: {
          name: 'test',
          email: 'test@open-paas.org'
        },
        subject: 'Heya',
        date: '2015-08-21T00:10:00Z',
        textBody: 'TextBody',
        htmlBody: '<p>HtmlBody</p>'
      };

      it('should quote htmlBody using a richtext template if not on mobile', function(done) {
        emailBodyService.quote(email)
          .then(function(text) {
            expect(text).to.equal('<p><br/></p><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote><p>HtmlBody</p></blockquote>');
          })
          .then(done, done);

        $rootScope.$digest();
      });

      it('should quote textBody using a richtext template if not on mobile and htmlBody is not available', function(done) {
        emailBodyService.quote(_.omit(email, 'htmlBody'))
          .then(function(text) {
            expect(text).to.equal('<p><br/></p><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote>TextBody</blockquote>');
          })
          .then(done, done);

        $rootScope.$digest();
      });

      it('should quote textBody using a plaintext template if on mobile', function(done) {
        isMobile = true;
        emailBodyService.quote(email)
          .then(function(text) {
            expect(text).to.equal('On Aug 21, 2015 12:10:00 AM from test@open-paas.org: TextBody');
          })
          .then(done, done);

        $rootScope.$digest();
      });

      it('should leverage the rich mode of forward template if specified', function(done) {
        emailBodyService.quote(email, 'forward')
          .then(function(text) {
            expect(text).to.equal('<p><br/></p><cite>------- Forwarded message -------<br/>Subject: Heya<br/>Date: Aug 21, 2015 12:10:00 AM<br/>From: test@open-paas.org<br/><br/></cite><blockquote><p>HtmlBody</p></blockquote>');
          })
          .then(done, done);

        $rootScope.$digest();
      });

      it('should leverage the text mode of forward template if specified', function(done) {
        isMobile = true;
        emailBodyService.quote(email, 'forward')
          .then(function(text) {
            expect(text).to.equal('------- Forwarded message ------- Subject: Heya Date: Aug 21, 2015 12:10:00 AM   TextBody');
          })
          .then(done, done);

        $rootScope.$digest();
      });

    });

    describe('The supportsRichtext function', function() {

      it('is true when deviceDetector.isMobile()=false', function() {
        expect(emailBodyService.supportsRichtext()).to.equal(true);
      });

      it('is false when deviceDetector.isMobile()=true', function() {
        isMobile = true;
        expect(emailBodyService.supportsRichtext()).to.equal(false);
      });

    });

    describe('The quoteOriginalEmail function', function() {

      var email;

      describe('With the "default" tempalte', function() {

        beforeEach(function() {
          email = {
            quoteTemplate: 'default',
            quoted: {
              from: {
                name: 'test',
                email: 'test@open-paas.org'
              },
              subject: 'Heya',
              date: '2015-08-21T00:10:00Z',
              htmlBody: '<p>HtmlBody</p>'
            }
          };
        });

        it('should quote the original email, using htmlBody when defined', function(done) {
          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre></pre><br/><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote><p>HtmlBody</p></blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

        it('should quote the original email, using textBody when htmlBody is not defined', function(done) {
          email.quoted.textBody = 'Hello';
          email.quoted.htmlBody = '';

          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre></pre><br/><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote>Hello</blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

        it('should quote the original email, keeping the already entered text when present', function(done) {
          email.textBody = 'I was previously typed';

          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre>I was previously typed</pre><br/><cite>On Aug 21, 2015 12:10:00 AM, from test@open-paas.org</cite><blockquote><p>HtmlBody</p></blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

      });

      describe('With the "forward" tempalte', function() {

        beforeEach(function() {
          email = {
            quoteTemplate: 'forward',
            quoted: {
              from: {
                name: 'test',
                email: 'test@open-paas.org'
              },
              subject: 'Heya',
              date: '2015-08-21T00:10:00Z',
              htmlBody: '<p>HtmlBody</p>'
            }
          };
        });

        it('should quote the original email, using htmlBody when defined', function(done) {
          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre></pre><br/><cite>------- Forwarded message -------<br/>Subject: Heya<br/>Date: Aug 21, 2015 12:10:00 AM<br/>From: test@open-paas.org<br/><br/></cite><blockquote><p>HtmlBody</p></blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

        it('should quote the original email, using textBody when htmlBody is not defined', function(done) {
          email.quoted.textBody = 'Hello';
          email.quoted.htmlBody = '';

          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre></pre><br/><cite>------- Forwarded message -------<br/>Subject: Heya<br/>Date: Aug 21, 2015 12:10:00 AM<br/>From: test@open-paas.org<br/><br/></cite><blockquote>Hello</blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

        it('should quote the original email, keeping the already entered text when present', function(done) {
          email.textBody = 'I was previously typed';

          emailBodyService.quoteOriginalEmail(email)
            .then(function(text) {
              expect(text).to.equal('<pre>I was previously typed</pre><br/><cite>------- Forwarded message -------<br/>Subject: Heya<br/>Date: Aug 21, 2015 12:10:00 AM<br/>From: test@open-paas.org<br/><br/></cite><blockquote><p>HtmlBody</p></blockquote>');
            })
            .then(done, done);

          $rootScope.$digest();
        });

      });

    });

  });

  describe('The mailboxesService factory', function() {

    var mailboxesService, jmapClient, $rootScope;

    beforeEach(module(function($provide) {
      jmapClient = {
        getMailboxes: function() { return $q.when([]); }
      };

      $provide.value('withJmapClient', function(callback) { return callback(jmapClient); });
    }));

    beforeEach(inject(function(_mailboxesService_, _$rootScope_) {
      mailboxesService = _mailboxesService_;
      $rootScope = _$rootScope_;
    }));

    describe('The filterSystemMailboxes function', function() {

      it('should filter mailboxes with a known role', function() {
        var mailboxes = [
          { id: 1, role: { value: 'inbox' } },
          { id: 2, role: { } },
          { id: 3, role: { value: null } },
          { id: 4, role: { value: 'outbox' } }
        ];
        var expected = [
          { id: 2, role: { } },
          { id: 3, role: { value: null } }
        ];

        expect(mailboxesService.filterSystemMailboxes(mailboxes)).to.deep.equal(expected);
      });

      it('should return an empty array if an empty array is given', function() {
        expect(mailboxesService.filterSystemMailboxes([])).to.deep.equal([]);
      });

      it('should return an empty array if nothing is given', function() {
        expect(mailboxesService.filterSystemMailboxes()).to.deep.equal([]);
      });

    });

    describe('The assignMailboxesList function', function() {

      it('should return a promise', function(done) {
        mailboxesService.assignMailboxesList().then(function(mailboxes) {
          expect(mailboxes).to.deep.equal([]);

          done();
        });

        $rootScope.$digest();
      });

      it('should assign dst.mailboxes if dst is given', function(done) {
        var object = {};

        mailboxesService.assignMailboxesList(object).then(function(mailboxes) {
          expect(object.mailboxes).to.deep.equal([]);

          done();
        });

        $rootScope.$digest();
      });

      it('should assign dst.mailboxes if dst is given and dst.mailboxes does not exist yet', function(done) {
        var object = { mailboxes: 'Yolo' };

        mailboxesService.assignMailboxesList(object).then(function(mailboxes) {
          expect(object.mailboxes).to.equal('Yolo');

          done();
        });

        $rootScope.$digest();
      });

      it('should filter mailboxes using a filter, if given', function(done) {
        jmapClient.getMailboxes = function() {
          return $q.when([{}, {}, {}]);
        };
        mailboxesService.assignMailboxesList(null, function(mailboxes) {
          return mailboxes.slice(0, 1);
        }).then(function(mailboxes) {
          expect(mailboxes).to.have.length(1);

          done();
        });

        $rootScope.$digest();
      });

      it('should add level and qualifiedName properties to mailboxes', function(done) {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1' },
            { id: 2, name: '2', parentId: 1 },
            { id: 3, name: '3', parentId: 2 },
            { id: 4, name: '4' },
            { id: 5, name: '5', parentId: 1 }
          ]);
        };
        var expected = [
          { id: 1, name: '1', level: 1, qualifiedName: '1' },
          { id: 2, name: '2', parentId: 1, level: 2, qualifiedName: '1 / 2' },
          { id: 3, name: '3', parentId: 2, level: 3, qualifiedName: '1 / 2 / 3' },
          { id: 4, name: '4', level: 1, qualifiedName: '4' },
          { id: 5, name: '5', parentId: 1, level: 2, qualifiedName: '1 / 5' }
        ];

        mailboxesService.assignMailboxesList().then(function(mailboxes) {
          expect(mailboxes).to.deep.equal(expected);

          done();
        });

        $rootScope.$digest();
      });

    });

    describe('The flagIsUnreadChanged function', function() {

      it('should do nothing if mail is undefined', function() {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1',  unreadMessages: 1}
          ]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();

        expect(mailboxesService.flagIsUnreadChanged()).to.be.undefined;
      });

      it('should do nothing if status is undefined', function() {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1',  unreadMessages: 1}
          ]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();

        expect(mailboxesService.flagIsUnreadChanged({ mailboxIds: [1] })).to.be.undefined;
      });

      it('should increase the unreadMessages in the mailboxesCache if status=true', function() {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1',  unreadMessages: 1}
          ]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();

        expect(mailboxesService.flagIsUnreadChanged({ mailboxIds: [1] }, true)[0].unreadMessages).to.equal(2);
      });

      it('should decrease the unreadMessages in the mailboxesCache if status=false', function() {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1',  unreadMessages: 1}
          ]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();

        expect(mailboxesService.flagIsUnreadChanged({ mailboxIds: [1] }, false)[0].unreadMessages).to.equal(0);
      });

      it('should guarantee that the unreadMessages in the mailboxesCache is never negative', function() {
        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, name: '1',  unreadMessages: 0}
          ]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();

        expect(mailboxesService.flagIsUnreadChanged({ mailboxIds: [1] }, false)[0].unreadMessages).to.equal(0);
      });
    });

    describe('The assignMailbox function', function() {

      beforeEach(function() {
        jmapClient.getMailboxes = function() {
          return $q.when([{name: 'name'}]);
        };
      });

      it('should return a promise', function(done) {

        mailboxesService.assignMailbox().then(function() {

          done();
        });

        $rootScope.$digest();
      });

      it('should pass the mailbox.id to jmapClient.getMailboxes', function(done) {

        jmapClient.getMailboxes = function(data) {
          expect(data).to.deep.equal({ids: [2]});
          done();
        };

        mailboxesService.assignMailbox(2);
      });

      it('should assign dst.mailbox if dst is given', function(done) {
        var object = {};

        mailboxesService.assignMailbox(null, object).then(function() {
          expect(object.mailbox).to.deep.equal({name: 'name', level: 1, qualifiedName: 'name'});

          done();
        });

        $rootScope.$digest();
      });

      it('should assign dst.mailbox if dst is given and dst.mailbox does not exist yet', function(done) {
        var object = { mailbox: 'mailbox' };

        mailboxesService.assignMailbox(null, object).then(function() {
          expect(object.mailbox).to.equal('mailbox');

          done();
        });

        $rootScope.$digest();
      });

      it('should add level and qualifiedName properties to mailbox', function() {
        mailboxesService.assignMailbox().then(function(mailbox) {
          expect(mailbox).to.deep.equal({name: 'name', level: 1, qualifiedName: 'name'});
        });

        $rootScope.$digest();
      });
    });

    describe('The updateUnreadMessages function', function() {

      it('should update unreadMessages of all available mailboxes corresponding to given mailboxIds', function() {
        var destObject = {};

        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, unreadMessages: 1},
            { id: 2, unreadMessages: 2},
            { id: 3, unreadMessages: 3}
          ]);
        };

        mailboxesService.assignMailboxesList(destObject);
        $rootScope.$digest();
        mailboxesService.updateUnreadMessages([1, 3, 4], 1);

        expect(destObject.mailboxes).to.shallowDeepEqual([
          { id: 1, unreadMessages: 2},
          { id: 2, unreadMessages: 2},
          { id: 3, unreadMessages: 4}
        ]);
      });

      it('should guarantee that the unreadMessages of the mailboxes is never negative', function() {
        var destObject = {};

        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, unreadMessages: 1},
            { id: 2, unreadMessages: 2}
          ]);
        };

        mailboxesService.assignMailboxesList(destObject);
        $rootScope.$digest();
        mailboxesService.updateUnreadMessages([1, 2], -2);

        expect(destObject.mailboxes).to.shallowDeepEqual([
          { id: 1, unreadMessages: 0},
          { id: 2, unreadMessages: 0}
        ]);
      });

    });

    describe('The moveUnreadMessages function', function() {

      it('should decrease unread messages of from mailboxes and increase it for to mailboxes', function() {
        var destObject = {};

        jmapClient.getMailboxes = function() {
          return $q.when([
            { id: 1, unreadMessages: 1},
            { id: 2, unreadMessages: 2}
          ]);
        };

        mailboxesService.assignMailboxesList(destObject);
        $rootScope.$digest();
        mailboxesService.moveUnreadMessages([1], [2], 1);

        expect(destObject.mailboxes).to.shallowDeepEqual([
          { id: 1, unreadMessages: 0},
          { id: 2, unreadMessages: 3}
        ]);
      });

    });

    describe('The canMoveMessage function', function() {

      var message, mailbox, draftMailbox, outboxMailbox;
      var jmap;

      beforeEach(function() {
        message = {
          isDraft: false,
          mailboxIds: [0]
        };
        mailbox = {
          id: 1,
          role: {}
        };
      });

      beforeEach(inject(function(_jmap_) {
        jmap = _jmap_;

        draftMailbox = { id: 11, role: jmap.MailboxRole.DRAFTS };
        outboxMailbox = { id: 22, role: jmap.MailboxRole.OUTBOX };
        jmapClient.getMailboxes = function() {
          return $q.when([draftMailbox, outboxMailbox]);
        };
        mailboxesService.assignMailboxesList({});
        $rootScope.$digest();
      }));

      function checkResult(result) {
        expect(mailboxesService.canMoveMessage(message, mailbox)).to.equal(result);
      }

      it('should allow moving message to mailbox by default value', function() {
        checkResult(true);
      });

      it('should disallow moving draft message', function() {
        message.isDraft = true;
        checkResult(false);
      });

      it('should disallow moving message to same mailbox', function() {
        message.mailboxIds = [1, 2];
        checkResult(false);
      });

      it('should disallow moving message to Draft mailbox', function() {
        mailbox.role = jmap.MailboxRole.DRAFTS;
        checkResult(false);
      });

      it('should disallow moving message to Outbox mailbox', function() {
        mailbox.role = jmap.MailboxRole.OUTBOX;
        checkResult(false);
      });

      it('should disallow moving message out from Draft mailbox', function() {
        message.mailboxIds = [draftMailbox.id];
        checkResult(false);
      });

      it('should disallow moving message out from Outbox mailbox', function() {
        message.mailboxIds = [outboxMailbox.id];
        checkResult(false);
      });

      it('should allow moving message out from mailbox that is not in mailboxesCache', function() {
        message.mailboxIds = [99];
        checkResult(true);
      });

    });

  });

  describe('The asyncAction factory', function() {

    var asyncAction, notificationFactory, notification, $rootScope, mockedFailureHandler;

    function qNoop() {
      return $q.when();
    }

    function qReject() {
      return $q.reject();
    }

    beforeEach(module(function($provide) {
      notification = {
        close: sinon.spy()
      };
      mockedFailureHandler = sinon.spy();
      notificationFactory = {
        strongInfo: sinon.spy(function() { return notification; }),
        weakSuccess: sinon.spy(),
        weakError: sinon.stub().returns({ setCancelAction: mockedFailureHandler })
      };

      $provide.value('notificationFactory', notificationFactory);
    }));

    beforeEach(inject(function(_asyncAction_, _$rootScope_) {
      asyncAction = _asyncAction_;
      $rootScope = _$rootScope_;
    }));

    it('should start the action', function() {
      var action = sinon.spy(qNoop);

      asyncAction('Test', action);
      $rootScope.$digest();

      expect(action).to.have.been.calledWith();
    });

    it('should notify strongInfo when starting the action', function() {
      asyncAction('Test', qNoop);
      $rootScope.$digest();

      expect(notificationFactory.strongInfo).to.have.been.calledWith('', 'Test in progress...');
    });

    it('should close the strongInfo notification when action resolves', function() {
      asyncAction('Test', qNoop);
      $rootScope.$digest();

      expect(notification.close).to.have.been.calledWith();
    });

    it('should close the strongInfo notification when action rejects', function() {
      asyncAction('Test', qReject);
      $rootScope.$digest();

      expect(notification.close).to.have.been.calledWith();
    });

    it('should notify weakSuccess when action resolves', function() {
      asyncAction('Test', qNoop);
      $rootScope.$digest();

      expect(notificationFactory.weakSuccess).to.have.been.calledWith('', 'Test succeeded');
    });

    it('should notify weakError when action rejects', function() {
      asyncAction('Test', qReject);
      $rootScope.$digest();

      expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Test failed');
    });

    it('should provide a link when failure options is provided', function() {
      var failureConfig = { linkText: 'Test', action: function() {} };
      asyncAction('Test', qReject, { onFailure: failureConfig });
      $rootScope.$digest();

      expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Test failed');
      expect(mockedFailureHandler).to.have.been.calledWith(failureConfig);
    });

    it('should NOT provide any link when no failure option is provided', function() {
      asyncAction('Test', qReject);
      $rootScope.$digest();

      expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Test failed');
      expect(mockedFailureHandler).to.have.not.been.called;
    });

    it('should return a promise resolving to the resolved value of the action', function(done) {
      asyncAction('Test', function() { return $q.when(1); })
        .then(function(result) {
          expect(result).to.equal(1);

          done();
        });

      $rootScope.$digest();
    });

    it('should return a promise rejecting with the rejection value of the action', function(done) {
      asyncAction('Test', function() { return $q.reject('Bouh !'); })
        .then(function() {
          done('The promise should not be resolved !');
        }, function(result) {
          expect(result).to.equal('Bouh !');

          done();
        });

      $rootScope.$digest();
    });

    it('should not notify when options has silent', function() {
      asyncAction('Test', qNoop, {silent: true});
      $rootScope.$digest();

      expect(notificationFactory.strongInfo).to.not.have.been.called;
      expect(notificationFactory.weakSuccess).to.not.have.been.called;
    });

    it('should notify error even when options has silent', function(done) {
      asyncAction('Test', qReject, {silent: true})
        .then(function() {
          done('The promise should not be resolved !');
        }, function() {
          expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Test failed');
          done();
        });

      $rootScope.$digest();
    });

  });

  describe('The rejectWithErrorNotification factory', function() {
    var $rootScope;
    var rejectWithErrorNotification;
    var notificationFactoryMock;

    beforeEach(function() {
      notificationFactoryMock = {
        weakError: angular.noop
      };

      module(function($provide) {
        $provide.value('notificationFactory', notificationFactoryMock);
      });

      inject(function(_$rootScope_, _rejectWithErrorNotification_) {
        $rootScope = _$rootScope_;
        rejectWithErrorNotification = _rejectWithErrorNotification_;
      });
    });

    it('should show notification with error message', function() {
      var msg = 'error message';

      notificationFactoryMock.weakError = sinon.spy();

      rejectWithErrorNotification(msg);

      expect(notificationFactoryMock.weakError).to.have.been.calledWithExactly('Error', msg);
    });

    it('should reject promise with error message', function(done) {
      var msg = 'error message';

      rejectWithErrorNotification(msg)
        .then(done.bind(null, 'should reject'), function(err) {
          expect(err.message).to.equal(msg);
          done();
        });

      $rootScope.$digest();
    });
  });

  describe('The backgroundAction factory', function() {

    var $rootScope, backgroundAction, asyncAction, backgroundProcessorService;

    beforeEach(module(function($provide) {
      $provide.value('asyncAction', asyncAction = sinon.spy(function(message, action, options) {
        return action();
      }));
    }));

    beforeEach(inject(function(_$rootScope_, _backgroundAction_, _backgroundProcessorService_) {
      $rootScope = _$rootScope_;
      backgroundAction = _backgroundAction_;
      backgroundProcessorService = _backgroundProcessorService_;
    }));

    it('should wrap the action into a background asyncAction', function() {
      var message = 'action message',
          options = {expected: 'opts'},
          action = sinon.stub().returns($q.when());

      backgroundAction(message, action, options);
      var afterSubmitTaskCount = backgroundProcessorService.tasks.length;

      $rootScope.$digest();
      var afterDigestTaskCount = backgroundProcessorService.tasks.length;

      expect(afterSubmitTaskCount).to.equal(1);
      expect(afterDigestTaskCount).to.equal(0);
      expect(action).to.have.been.calledOnce;
      expect(asyncAction).to.have.been.calledWith(message, sinon.match.func, options);
    });

    it('should resolve with the action result when succeed', function(done) {
      var actionResult = {result: 'value'},
          action = sinon.stub().returns($q.when(actionResult));

      backgroundAction('action message', action).then(function(resolvedValue) {
        expect(resolvedValue).to.deep.equal(actionResult);
        done();
      }, done);
      $rootScope.$digest();
    });

    it('should resolve with the action error when failed', function(done) {
      var actionError = new Error('expect error'),
          action = sinon.stub().returns($q.reject(actionError));

      backgroundAction('action message', action).then(
        done.bind(null, 'should be rejected'),
        function(err) {
          expect(err).to.deep.equal(actionError);
          done();
        });
      $rootScope.$digest();
    });
  });

  describe('The asyncJmapAction factory', function() {

    var asyncJmapAction, backgroundAction, withJmapClient;

    beforeEach(module(function($provide) {
      $provide.value('backgroundAction', sinon.spy(function(message, action) { return action(); }));
      $provide.value('withJmapClient', sinon.spy(function(callback) { return callback; }));
    }));

    beforeEach(inject(function(_asyncJmapAction_, _backgroundAction_, _withJmapClient_) {
      backgroundAction = _backgroundAction_;
      withJmapClient = _withJmapClient_;
      asyncJmapAction = _asyncJmapAction_;
    }));

    it('should delegate to backgroundAction, forwarding the message and the wrapped action', function() {
      asyncJmapAction('Message', 1, {expected: 'options'});

      expect(withJmapClient).to.have.been.calledWith(1);
      expect(backgroundAction).to.have.been.calledWith('Message', sinon.match.func, {expected: 'options'});
    });

  });

  describe('The searchService factory', function() {

    var $rootScope, searchService;

    beforeEach(inject(function(_$rootScope_, _searchService_) {
      $rootScope = _$rootScope_;
      searchService = _searchService_;
    }));

    describe('The searchRecipients method', function() {

      it('should delegate to attendeeService', function() {
        attendeeService.getAttendeeCandidates = sinon.spy(function() { return $q.when(); });

        searchService.searchRecipients('open-paas.org');

        expect(attendeeService.getAttendeeCandidates).to.have.been.calledWith('open-paas.org');
      });

      it('should return an empty array if the search fails', function(done) {
        attendeeService.getAttendeeCandidates = sinon.spy(function() { return $q.reject(); });

        searchService.searchRecipients('open-paas.org').then(function(results) {
          expect(results).to.deep.equal([]);

          done();
        });
        $rootScope.$digest();
      });

      it('should exclude search results with no email', function(done) {
        attendeeService.getAttendeeCandidates = function(query) {
          expect(query).to.equal('open-paas.org');

          return $q.when([{
            name: 'user1',
            email: 'user1@open-paas.org'
          }, {
            name: 'user2'
          }]);
        };

        searchService.searchRecipients('open-paas.org')
          .then(function(results) {
            expect(results).to.deep.equal([{
              name: 'user1',
              email: 'user1@open-paas.org'
            }]);
          })
          .then(done, done);

        $rootScope.$digest();
      });

      it('should assign name of the recipient from its displayName when he has none', function(done) {
        attendeeService.getAttendeeCandidates = function(query) {
          expect(query).to.equal('open-paas.org');

          return $q.when([{
            name: '',
            email: 'empty@open-paas.org'
          }, {
            email: 'none@open-paas.org'
          }, {
            name: 'expected name',
            displayName: 'not expected name',
            email: 'with-name@open-paas.org'
          }, {
            displayName: 'expected name',
            email: 'with-display-name-only@open-paas.org'
          }]);
        };

        searchService.searchRecipients('open-paas.org')
          .then(function(results) {
            expect(results).to.deep.equal([{
              name: 'empty@open-paas.org',
              email: 'empty@open-paas.org'
            }, {
              name: 'none@open-paas.org',
              email: 'none@open-paas.org'
            }, {
              name: 'expected name',
              displayName: 'not expected name',
              email: 'with-name@open-paas.org'
            }, {
              name: 'expected name',
              displayName: 'expected name',
              email: 'with-display-name-only@open-paas.org'
            }]);
          })
          .then(done, done);

        $rootScope.$digest();
      });

    });

    describe('The searchByEmail method', function() {

      it('should delegate to attendeeService, requesting a single result, and return the match if there is one', function(done) {
        attendeeService.getAttendeeCandidates = sinon.spy(function() { return $q.when([{ a: 'b' }]); });

        searchService.searchByEmail('me@open-paas.org').then(function(result) {
          expect(attendeeService.getAttendeeCandidates).to.have.been.calledWith('me@open-paas.org', 1);
          expect(result).to.deep.equal({ a: 'b' });

          done();
        });
        $rootScope.$digest();
      });

      it('should return null if there is no match', function(done) {
        attendeeService.getAttendeeCandidates = sinon.spy(function() { return $q.when([]); });

        searchService.searchByEmail('me@open-paas.org').then(function(result) {
          expect(result).to.equal(null);

          done();
        });
        $rootScope.$digest();
      });

      it('should return null if search fails', function(done) {
        attendeeService.getAttendeeCandidates = sinon.spy(function() { return $q.reject(); });

        searchService.searchByEmail('me@open-paas.org').then(function(result) {
          expect(result).to.equal(null);

          done();
        });
        $rootScope.$digest();
      });

    });

  });

  describe('The jmapEmailService factory', function() {

    var $rootScope, jmapEmailService, jmap, mailboxesService, notificationFactory, backgroundProcessorService;

    function newEmail(isUnread) {
      var email = new jmap.Message({}, 'id', 'threadId', ['inbox'], { isUnread: isUnread });

      email.setIsUnread = function() { return $q.when(); };

      return email;
    }

    beforeEach(module(function($provide) {
      $provide.value('mailboxesService', mailboxesService = {
        flagIsUnreadChanged: sinon.spy()
      });
    }));

    beforeEach(inject(function(_$rootScope_, _jmapEmailService_, _jmap_,
             _notificationFactory_, _backgroundProcessorService_) {
      $rootScope = _$rootScope_;
      jmapEmailService = _jmapEmailService_;
      jmap = _jmap_;
      notificationFactory = _notificationFactory_;
      backgroundProcessorService = _backgroundProcessorService_;

      notificationFactory.weakError = sinon.spy();
    }));

    describe('The setFlag function', function() {

      it('should throw an Error if email is undefined', function() {
        expect(function() {
          jmapEmailService.setFlag();
        }).to.throw(Error);
      });

      it('should throw an Error if email is not a jmap.Message', function() {
        expect(function() {
          jmapEmailService.setFlag({});
        }).to.throw(Error);
      });

      it('should throw an Error if flag is undefined', function() {
        expect(function() {
          jmapEmailService.setFlag(newEmail());
        }).to.throw(Error);
      });

      it('should throw an Error if state is undefined', function() {
        expect(function() {
          jmapEmailService.setFlag(newEmail(), 'isUnread');
        }).to.throw(Error);
      });

      it('should return the Promise resolving to the given email object', function(done) {
        var givenEmail = newEmail();

        jmapEmailService.setFlag(givenEmail, 'isUnread', true).then(function(resolvedValue) {
          expect(resolvedValue).to.deep.equal(givenEmail);
          done();
        }, done);

        $rootScope.$digest();
      });

      it('should call setXXX on the email object, passing the given state', function(done) {
        var email = newEmail();

        email.setIsUnread = function(state) {
          expect(state).to.equal(true);

          done();
        };

        jmapEmailService.setFlag(email, 'isUnread', true);
        $rootScope.$digest();
      });

      it('should change the local flag without waiting for a reply, and submit a background task', function() {
        var email = newEmail();

        jmapEmailService.setFlag(email, 'isUnread', true);
        expect(email.isUnread).to.equal(true);
        expect(backgroundProcessorService.tasks.length).to.equal(1);
      });

      it('should revert the local flag on the email object on failure', function(done) {
        var email = newEmail();
        email.setIsUnread = function() { return $q.reject(); };

        jmapEmailService.setFlag(email, 'isUnread', true).then(null, function() {
          expect(email.isUnread).to.equal(false);
          expect(notificationFactory.weakError).to.have.been.calledWith('Error', 'Changing a message flag failed');

          done();
        });
        $rootScope.$digest();
      });

      it('should not call setXXX on the email object if the local flag matches the given state, and return a Promise resolving to the given element', function(done) {
        var email = newEmail(true);

        email.setIsUnread = function() { done('This test should not call setIsUnread'); };

        jmapEmailService.setFlag(email, 'isUnread', true).then(function(resolvedValue) {
          expect(resolvedValue).to.deep.equal(email);
          done();
        });
        $rootScope.$digest();
      });

    });

  });

  describe('The inboxEmailService service', function() {

    var $rootScope, $state, jmap, jmapEmailService, inboxEmailService, newComposerService, emailSendingService,
        quoteEmail, jmapClientMock, backgroundAction;

    beforeEach(module(function($provide) {
      jmapClientMock = {};
      quoteEmail = function(email) { return {transformed: 'value'}; };

      $provide.value('jmapEmailService', jmapEmailService = { setFlag: sinon.spy() });
      $provide.value('withJmapClient', function(callback) { return callback(jmapClientMock); });
      $provide.value('$state', $state = { go: sinon.spy() });
      $provide.value('newComposerService', newComposerService = { open: sinon.spy() });
      $provide.value('backgroundAction', sinon.spy(function(message, action) { return action(); }));
      $provide.value('emailSendingService', emailSendingService = {
        createReplyEmailObject: sinon.spy(function(email) { return $q.when(quoteEmail(email)); }),
        createReplyAllEmailObject: sinon.spy(function(email) { return $q.when(quoteEmail(email)); }),
        createForwardEmailObject: sinon.spy(function(email) { return $q.when(quoteEmail(email)); })
      });
    }));

    beforeEach(inject(function(_$rootScope_, _jmap_, _inboxEmailService_, _backgroundAction_) {
      $rootScope = _$rootScope_;
      jmap = _jmap_;
      inboxEmailService = _inboxEmailService_;
      backgroundAction = _backgroundAction_;
    }));

    describe('The moveToTrash fn', function() {

      it('should call email.moveToMailboxWithRole with the "trash" role', function(done) {
        inboxEmailService.moveToTrash({
          moveToMailboxWithRole: function(role) {
            expect(role).to.equal(jmap.MailboxRole.TRASH);

            done();
          }
        });
      });

      it('should pass options to backgroundAction', function() {
        var email = {
          moveToMailboxWithRole: sinon.spy()
        };
        inboxEmailService.moveToTrash(email, {option: 'option'});

        expect(email.moveToMailboxWithRole).to.have.been.called;
        expect(backgroundAction).to.have.been.calledWith(sinon.match.string, sinon.match.func, {option: 'option'});
      });

    });

    describe('The moveToMailbox function', function() {

      var mailboxesService;

      beforeEach(inject(function(_mailboxesService_) {
        mailboxesService = _mailboxesService_;
      }));

      it('should use move method of message to move the message to new mailbox', function(done) {
        var message = {
          id: 'm111',
          mailboxIds: [],
          move: sinon.stub().returns($q.when())
        };

        inboxEmailService.moveToMailbox(message, { id: '1' })
          .then(function() {
            expect(message.move).to.have.been.calledWith(['1']);
            done();
          });

        $rootScope.$digest();
      });

      it('should immediately update unreadMessages of old and new mailboxes if the message is unread', function() {
        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');
        var newMailbox = { id: 1 };
        var message = {
          id: 'm111',
          isUnread: true,
          mailboxIds: [2, 3],
          move: function() { return $q.when(); }
        };

        inboxEmailService.moveToMailbox(message, newMailbox);

        expect(moveUnreadMessagesSpy).to.have.been.calledOnce;
        expect(moveUnreadMessagesSpy)
          .to.have.been.calledWith(message.mailboxIds, [newMailbox.id], 1);
      });

      it('should not update unreadMessages of old and new mailboxes if the message is read', function() {
        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');
        var newMailbox = { id: 1 };
        var message = {
          id: 'm111',
          isUnread: false,
          mailboxIds: [2, 3],
          move: function() { return $q.when(); }
        };

        inboxEmailService.moveToMailbox(message, newMailbox);

        expect(moveUnreadMessagesSpy).to.have.been.callCount(0);
      });

      it('should revert unreadMessages changes on failure of the move if the message is unread', function() {
        var newMailbox = { id: 1 };
        var message = {
          id: 'm111',
          isUnread: true,
          mailboxIds: [2, 3],
          move: function() { return $q.reject(); }
        };

        inboxEmailService.moveToMailbox(message, newMailbox);

        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');

        $rootScope.$digest();

        expect(moveUnreadMessagesSpy).to.have.been.calledOnce;
        expect(moveUnreadMessagesSpy)
          .to.have.been.calledWith([newMailbox.id], message.mailboxIds, 1);
      });

      it('should not revert unreadMessages changes on failure of the move if the message is read', function() {
        var newMailbox = { id: 1 };
        var message = {
          id: 'm111',
          isUnread: false,
          mailboxIds: [2, 3],
          move: function() { return $q.reject(); }
        };

        inboxEmailService.moveToMailbox(message, newMailbox);

        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');

        $rootScope.$digest();

        expect(moveUnreadMessagesSpy).to.have.been.callCount(0);
      });
    });

    describe('The reply function', function() {

      it('should leverage open() and createReplyEmailObject()', function() {
        var inputEmail = {input: 'value'};
        inboxEmailService.reply(inputEmail);
        $rootScope.$digest();

        expect(emailSendingService.createReplyEmailObject).to.have.been.calledWith(inputEmail);
        expect(newComposerService.open).to.have.been.calledWith(quoteEmail(inputEmail), 'Start writing your reply email');
      });

    });

    describe('The replyAll function', function() {

      it('should leverage open() and createReplyAllEmailObject()', function() {
        var inputEmail = {input: 'value'};
        inboxEmailService.replyAll(inputEmail);
        $rootScope.$digest();

        expect(emailSendingService.createReplyAllEmailObject).to.have.been.calledWith(inputEmail);
        expect(newComposerService.open).to.have.been.calledWith(quoteEmail(inputEmail), 'Start writing your reply all email');
      });

    });

    describe('The forward function', function() {

      it('should leverage open() and createForwardEmailObject()', function() {
        var inputEmail = {input: 'value'};
        inboxEmailService.forward(inputEmail);
        $rootScope.$digest();

        expect(emailSendingService.createForwardEmailObject).to.have.been.calledWith(inputEmail);
        expect(newComposerService.open).to.have.been.calledWith(quoteEmail(inputEmail), 'Start writing your forward email');
      });

    });

    describe('The markAsUnread function', function() {

      beforeEach(function() {
        jmapEmailService.setFlag = sinon.spy(function() {
          return $q.reject();
        });
      });

      it('should call jmapEmailService.setFlag', function() {
        inboxEmailService.markAsUnread({});

        expect(jmapEmailService.setFlag).to.have.been.calledWith(sinon.match.any, 'isUnread', true);
      });

    });

    describe('The markAsRead function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxEmailService.markAsRead({});

        expect(jmapEmailService.setFlag).to.have.been.calledWith(sinon.match.any, 'isUnread', false);
      });
    });

    describe('The markAsFlagged function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxEmailService.markAsFlagged({});

        expect(jmapEmailService.setFlag).to.have.been.calledWith(sinon.match.any, 'isFlagged', true);
      });

    });

    describe('The unmarkAsFlagged function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxEmailService.unmarkAsFlagged({});

        expect(jmapEmailService.setFlag).to.have.been.calledWith(sinon.match.any, 'isFlagged', false);
      });

    });

  });

  describe('The inboxThreadService service', function() {

    var $rootScope, $state, jmap, jmapEmailService, inboxThreadService, jmapClientMock, backgroundAction;

    beforeEach(module(function($provide) {
      jmapClientMock = {};

      $provide.value('jmapEmailService', jmapEmailService = { setFlag: sinon.spy() });
      $provide.value('withJmapClient', function(callback) { return callback(jmapClientMock); });
      $provide.value('$state', $state = { go: sinon.spy() });
      $provide.value('backgroundAction', sinon.spy(function(message, action) { return action(); }));
    }));

    beforeEach(inject(function(_$rootScope_, _jmap_, _inboxThreadService_, _backgroundAction_) {
      $rootScope = _$rootScope_;
      jmap = _jmap_;
      inboxThreadService = _inboxThreadService_;
      backgroundAction = _backgroundAction_;
    }));

    describe('The moveToTrash fn', function() {

      it('should call thread.moveToMailboxWithRole with the "trash" role', function(done) {
        inboxThreadService.moveToTrash({
          moveToMailboxWithRole: function(role) {
            expect(role).to.equal(jmap.MailboxRole.TRASH);

            done();
          }
        });
      });

      it('should pass options to backgroundAction', function() {
        var thread = {
          moveToMailboxWithRole: sinon.spy()
        };
        inboxThreadService.moveToTrash(thread, {option: 'option'});

        expect(thread.moveToMailboxWithRole).to.have.been.called;
        expect(backgroundAction).to.have.been.calledWith(sinon.match.string, sinon.match.func, {option: 'option'});
      });
    });

    describe('The moveToMailbox function', function() {

      var mailboxesService;

      beforeEach(inject(function(_mailboxesService_) {
        mailboxesService = _mailboxesService_;
      }));

      it('should use move method of thread to move the thread to new mailbox', function(done) {
        var thread = {
          messageIds: ['m1', 'm2', 'm3'],
          isUnread: true,
          email: {
            mailboxIds: [2, 3]
          },
          move: sinon.stub().returns($q.when())
        };

        inboxThreadService.moveToMailbox(thread, { id: '1' })
          .then(function() {
            expect(thread.move).to.have.been.calledWith(['1']);
            done();
          });

        $rootScope.$digest();
      });

      it('should immediately update unreadMessages of old and new mailboxes if the thread is unread', function() {
        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');
        var newMailbox = { id: 1 };
        var thread = {
          messageIds: ['m1', 'm2', 'm3'],
          isUnread: true,
          email: {
            mailboxIds: [2, 3]
          },
          move: function() { return $q.when(); }
        };

        inboxThreadService.moveToMailbox(thread, newMailbox);

        expect(moveUnreadMessagesSpy).to.have.been.calledOnce;
        expect(moveUnreadMessagesSpy)
          .to.have.been.calledWith(thread.email.mailboxIds, [newMailbox.id], 1);
      });

      it('should not update unreadMessages of old and new mailboxes if the thread is read', function() {
        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');
        var newMailbox = { id: 1 };
        var thread = {
          messageIds: ['m1', 'm2', 'm3'],
          isUnread: false,
          email: {
            mailboxIds: [2, 3]
          },
          move: function() { return $q.when(); }
        };

        inboxThreadService.moveToMailbox(thread, newMailbox);

        expect(moveUnreadMessagesSpy).to.have.been.callCount(0);
      });

      it('should revert unreadMessages changes on failure of the move if the thread is unread', function() {
        var newMailbox = { id: 1 };
        var thread = {
          messageIds: ['m1', 'm2', 'm3'],
          isUnread: true,
          email: {
            mailboxIds: [2, 3]
          },
          move: function() { return $q.reject(); }
        };

        inboxThreadService.moveToMailbox(thread, newMailbox);

        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');

        $rootScope.$digest();

        expect(moveUnreadMessagesSpy).to.have.been.calledOnce;
        expect(moveUnreadMessagesSpy)
          .to.have.been.calledWith([newMailbox.id], thread.email.mailboxIds, 1);
      });

      it('should not revert unreadMessages changes on failure of the move if the thread is read', function() {
        var newMailbox = { id: 1 };
        var thread = {
          messageIds: ['m1', 'm2', 'm3'],
          isUnread: false,
          email: {
            mailboxIds: [2, 3]
          },
          move: function() { return $q.reject(); }
        };

        inboxThreadService.moveToMailbox(thread, newMailbox);

        var moveUnreadMessagesSpy = sinon.spy(mailboxesService, 'moveUnreadMessages');

        $rootScope.$digest();

        expect(moveUnreadMessagesSpy).to.have.been.callCount(0);
      });

    });

    describe('The markAsUnread function', function() {

      beforeEach(function() {
        jmapEmailService.setFlag = sinon.spy(function() {
          return $q.reject();
        });
      });

      it('should call jmapEmailService.setFlag', function() {
        inboxThreadService.markAsUnread({ id: '1' });

        expect(jmapEmailService.setFlag).to.have.been.calledWith({ id: '1' }, 'isUnread', true);
      });

    });

    describe('The markAsRead function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxThreadService.markAsRead({ id: '1' });

        expect(jmapEmailService.setFlag).to.have.been.calledWith({ id: '1' }, 'isUnread', false);
      });
    });

    describe('The markAsFlagged function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxThreadService.markAsFlagged({ id: '1' });

        expect(jmapEmailService.setFlag).to.have.been.calledWith({ id: '1' }, 'isFlagged', true);
      });

    });

    describe('The unmarkAsFlagged function', function() {

      it('should call jmapEmailService.setFlag', function() {
        inboxThreadService.unmarkAsFlagged({ id: '1' });

        expect(jmapEmailService.setFlag).to.have.been.calledWith({ id: '1' }, 'isFlagged', false);
      });

    });

  });

  describe('The attachmentUploadService service', function() {

    var $rootScope, backgroundProcessorService, attachmentUploadService, file = { name: 'n', size: 1, type: 'type'};

    beforeEach(module(function($provide) {
      $provide.value('withJmapClient', function(callback) {
        return callback(null);
      });
      config['linagora.esn.unifiedinbox.uploadUrl'] = 'http://jmap';

      $.mockjaxSettings.logging = false;
    }));

    beforeEach(inject(function(_$rootScope_, _attachmentUploadService_, _backgroundProcessorService_) {
      $rootScope = _$rootScope_;
      attachmentUploadService = _attachmentUploadService_;
      backgroundProcessorService = _backgroundProcessorService_;

      sinon.spy(backgroundProcessorService, 'add');
    }));

    afterEach(function() {
      $.mockjax.clear();
    });

    it('should POST the file, passing the content type and resolve on success', function(done) {
      $.mockjax(function(options) {
        return {
          url: 'http://jmap',
          data: file,
          type: 'POST',
          response: function() {
            expect(options.headers['Content-Type']).to.equal(file.type);

            this.responseText = { a: 'b' };
          }
        };
      });

      attachmentUploadService
        .uploadFile(null, file, file.type, file.size, null, null)
        .then(function(data) {
          expect(data).to.deep.equal({ a: 'b' });

          done();
        });

      $rootScope.$digest();
    });

    it('should reject on error', function(done) {
      $.mockjax({
        url: 'http://jmap',
        response: function() {
          this.status = 500;
        }
      });

      attachmentUploadService
        .uploadFile(null, file, file.type, file.size, null, null)
        .then(null, function(err) {
          expect(err.xhr.status).to.equal(500);

          done();
        });

      $rootScope.$digest();
    });

    it('should reject on timeout', function(done) {
      $.mockjax({
        url: 'http://jmap',
        isTimeout: true
      });

      attachmentUploadService
        .uploadFile(null, file, file.type, file.size, null, null)
        .then(null, function(err) {
          expect(err.error).to.equal('timeout');

          done();
        });

      $rootScope.$digest();
    });

    it('should abort the request when the canceler resolves', function(done) {
      $.mockjax({
        url: 'http://jmap',
        responseTime: 10000
      });

      attachmentUploadService
        .uploadFile(null, file, file.type, file.size, null, $q.when())
        .then(done, function(err) {
          expect(err.error).to.equal('abort');

          done();
        });

      $rootScope.$digest();
    });

    it('should upload the file in background', function() {
      $.mockjax({
        url: 'http://jmap',
        type: 'POST',
        responseText: {a: 'b'}
      });

      attachmentUploadService.uploadFile(null, file, file.type, file.size, null, null);
      $rootScope.$digest();

      expect(backgroundProcessorService.add).to.have.been.calledWith();
    });

  });

  describe('The waitUntilMessageIsComplete factory', function() {

    var $rootScope, waitUntilMessageIsComplete;

    beforeEach(inject(function(_$rootScope_, _waitUntilMessageIsComplete_) {
      $rootScope = _$rootScope_;
      waitUntilMessageIsComplete = _waitUntilMessageIsComplete_;
    }));

    it('should resolve with the email when email has no attachments', function(done) {
      waitUntilMessageIsComplete({ subject: 'subject' }).then(function(value) {
        expect(value).to.deep.equal({ subject: 'subject' });

        done();
      });
      $rootScope.$digest();
    });

    it('should resolve when email attachments are all uploaded', function(done) {
      var message = {
        subject: 'subject',
        attachments: [{
          blobId: '1'
        }, {
          blobId: '2'
        }]
      };

      waitUntilMessageIsComplete(message).then(function(value) {
        expect(value).to.deep.equal(message);

        done();
      });
      $rootScope.$digest();
    });

    it('should resolve as soon as all attachments are done uploading', function(done) {
      var defer = $q.defer(),
          message = {
            subject: 'subject',
            attachments: [{
              blobId: '1',
              upload: {
                promise: $q.when()
              }
            }, {
              blobId: '',
              upload: {
                promise: defer.promise
              }
            }]
          };

      waitUntilMessageIsComplete(message).then(function(value) {
        expect(value).to.deep.equal(message);

        done();
      });
      defer.resolve();
      $rootScope.$digest();
    });

  });

  describe('The inboxSwipeHelper service', function() {

    var $rootScope, $timeout, inboxSwipeHelper;

    beforeEach(inject(function(_$rootScope_, _$timeout_, _inboxSwipeHelper_) {
      $rootScope = _$rootScope_;
      $timeout = _$timeout_;
      inboxSwipeHelper = _inboxSwipeHelper_;
    }));

    describe('The createSwipeRightHandler fn', function() {

      var swipeRightHandler;
      var scopeMock, handlersMock;

      beforeEach(function() {
        scopeMock = $rootScope.$new();
        scopeMock.swipeClose = sinon.spy();
        handlersMock = {
          markAsRead: sinon.spy()
        };

        swipeRightHandler = inboxSwipeHelper.createSwipeRightHandler(scopeMock, handlersMock);
      });

      it('should return a function', function() {
        expect(swipeRightHandler).to.be.a.function;
      });

      it('should return a function to close swipe after a timeout', function() {
        swipeRightHandler();
        $timeout.flush();

        expect(scopeMock.swipeClose).to.have.been.calledOnce;
      });

      it('should return a function to call markAsRead handle by default feature flip', function() {
        swipeRightHandler();
        $rootScope.$digest();

        expect(handlersMock.markAsRead).to.have.been.calledOnce;
      });

    });

    describe('The createSwipeLeftHandler fn', function() {

      var swipeLeftHandler;
      var scopeMock, handlersMock;

      beforeEach(function() {
        scopeMock = $rootScope.$new();
        scopeMock.swipeClose = sinon.spy();
        handlersMock = sinon.spy();

        swipeLeftHandler = inboxSwipeHelper.createSwipeLeftHandler(scopeMock, handlersMock);
      });

      it('should return a function', function() {
        expect(swipeLeftHandler).to.be.a.function;
      });

      it('should return a function to close swipe after a timeout', function() {
        swipeLeftHandler();
        $timeout.flush();

        expect(scopeMock.swipeClose).to.have.been.calledOnce;
      });

    });

  });

});
