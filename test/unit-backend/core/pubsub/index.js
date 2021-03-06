'use strict';

var chai = require('chai');
var expect = chai.expect;
var mockery = require('mockery');
var sinon = require('sinon');

describe('The pubsub module', function() {

  it('should initialize module pubsubs', function() {
    var asSpy = {init: sinon.spy()};
    var nSpy = {init: sinon.spy()};
    var esSpy = {init: sinon.spy()};
    mockery.registerMock('../activitystreams/pubsub', asSpy);
    mockery.registerMock('../notification/pubsub', nSpy);
    mockery.registerMock('../elasticsearch/pubsub', esSpy);

    var module = this.helpers.requireBackend('core/pubsub');
    module.init();
    expect(asSpy.init).to.have.been.called;
    expect(nSpy.init).to.have.been.called;
    expect(esSpy.init).to.have.been.called;
  });
});
