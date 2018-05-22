/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import * as assert from 'assert';
import * as duplexify from 'duplexify';
import * as extend from 'extend';
import * as grpc from 'grpc';
import * as is from 'is';
import * as proxyquire from 'proxyquire';
import * as retryRequest from 'retry-request';
import * as sn from 'sinon';
import * as through from 'through2';
import {util} from '@google-cloud/common';

const sinon = sn.createSandbox();

const fakeUtil = extend({}, util);

function FakeService() {
  this.calledWith_ = arguments;
}

let retryRequestOverride;
function fakeRetryRequest() {
  return (retryRequestOverride || retryRequest).apply(null, arguments);
}

let GrpcMetadataOverride;
let grpcLoadOverride;
const fakeGrpc = {
  Metadata() {
    if (GrpcMetadataOverride) {
      return new GrpcMetadataOverride();
    }
    return new grpc.Metadata();
  },
  load() {
    return (grpcLoadOverride || grpc.load).apply(null, arguments);
  },
  credentials: {
    combineChannelCredentials() {
      return {
        name: 'combineChannelCredentials',
        args: arguments,
      };
    },
    createSsl() {
      return {
        name: 'createSsl',
        args: arguments,
      };
    },
    createFromGoogleCredential() {
      return {
        name: 'createFromGoogleCredential',
        args: arguments,
      };
    },
    createInsecure() {
      return {
        name: 'createInsecure',
        args: arguments,
      };
    },
  },
};

describe('GrpcService', () => {
  let GrpcServiceCached;
  let GrpcService;
  let grpcService;

  let ObjectToStructConverter;

  const ROOT_DIR = '/root/dir';
  const PROTO_FILE_PATH = 'filepath.proto';
  const SERVICE_PATH = 'service.path';

  const CONFIG: any = {
    proto: {},
    protosDir: ROOT_DIR,
    protoServices: {
      Service: {
        path: PROTO_FILE_PATH,
        service: SERVICE_PATH,
      },
    },
    packageJson: {
      name: '@google-cloud/service',
      version: '0.2.0',
    },
    grpcMetadata: {
      property: 'value',
    },
  };

  const OPTIONS = {
    maxRetries: 3,
  };

  const EXPECTED_API_CLIENT_HEADER = [
    'gl-node/' + process.versions.node,
    'gccl/' + CONFIG.packageJson.version,
    'grpc/' + require('grpc/package.json').version,
  ].join(' ');

  const MOCK_GRPC_API = {
    google: {
      Service: {
        [SERVICE_PATH]: {},
      },
    },
  };

  before(() => {
    GrpcService = proxyquire('../src/service.js', {
      '@google-cloud/common': {
        Service: FakeService,
        util: fakeUtil,
      },
      grpc: fakeGrpc,
      'retry-request': fakeRetryRequest,
    }).GrpcService;
    GrpcServiceCached = extend(true, {}, GrpcService);
    ObjectToStructConverter = GrpcService.ObjectToStructConverter;
  });

  beforeEach(() => {
    GrpcMetadataOverride = null;
    retryRequestOverride = null;

    grpcLoadOverride = () => {
      return MOCK_GRPC_API;
    };

    extend(fakeUtil, util);
    extend(GrpcService, GrpcServiceCached);

    grpcService = new GrpcService(CONFIG, OPTIONS);
  });

  afterEach(() => {
    grpcLoadOverride = null;
    sinon.restore();
  });

  describe('grpc error to http error map', () => {
    it('should export grpc error map', () => {
      assert.deepEqual(GrpcService.GRPC_ERROR_CODE_TO_HTTP, {
        0: {
          code: 200,
          message: 'OK',
        },

        1: {
          code: 499,
          message: 'Client Closed Request',
        },

        2: {
          code: 500,
          message: 'Internal Server Error',
        },

        3: {
          code: 400,
          message: 'Bad Request',
        },

        4: {
          code: 504,
          message: 'Gateway Timeout',
        },

        5: {
          code: 404,
          message: 'Not Found',
        },

        6: {
          code: 409,
          message: 'Conflict',
        },

        7: {
          code: 403,
          message: 'Forbidden',
        },

        8: {
          code: 429,
          message: 'Too Many Requests',
        },

        9: {
          code: 412,
          message: 'Precondition Failed',
        },

        10: {
          code: 409,
          message: 'Conflict',
        },

        11: {
          code: 400,
          message: 'Bad Request',
        },

        12: {
          code: 501,
          message: 'Not Implemented',
        },

        13: {
          code: 500,
          message: 'Internal Server Error',
        },

        14: {
          code: 503,
          message: 'Service Unavailable',
        },

        15: {
          code: 500,
          message: 'Internal Server Error',
        },

        16: {
          code: 401,
          message: 'Unauthorized',
        },
      });
    });
  });

  describe('grpc service options', () => {
    it('should define the correct default options', () => {
      assert.deepEqual(GrpcService.GRPC_SERVICE_OPTIONS, {
        'grpc.max_send_message_length': -1,
        'grpc.max_receive_message_length': -1,
        'grpc.initial_reconnect_backoff_ms': 5000,
      });
    });
  });

  describe('instantiation', () => {
    it('should inherit from Service', () => {
      assert(grpcService instanceof FakeService);

      const calledWith = grpcService.calledWith_;
      assert.strictEqual(calledWith[0], CONFIG);
      assert.strictEqual(calledWith[1], OPTIONS);
    });

    it('should set insecure credentials if using customEndpoint', () => {
      const config = extend({}, CONFIG, {customEndpoint: true});
      const grpcService = new GrpcService(config, OPTIONS);
      assert.strictEqual(grpcService.grpcCredentials.name, 'createInsecure');
    });

    it('should default grpcMetadata to empty metadata', () => {
      const fakeGrpcMetadata = {
        'x-goog-api-client': EXPECTED_API_CLIENT_HEADER,
      };

      GrpcMetadataOverride = () => {};
      GrpcMetadataOverride.prototype.add = function(prop, val) {
        this[prop] = val;
      };

      const config = extend({}, CONFIG);
      delete config.grpcMetadata;

      const grpcService = new GrpcService(config, OPTIONS);
      assert.deepEqual(grpcService.grpcMetadata, fakeGrpcMetadata);
    });

    it('should create and localize grpcMetadata', () => {
      const fakeGrpcMetadata = extend(
        {
          'x-goog-api-client': EXPECTED_API_CLIENT_HEADER,
        },
        CONFIG.grpcMetadata
      );

      GrpcMetadataOverride = () => {};
      GrpcMetadataOverride.prototype.add = function(prop, val) {
        this[prop] = val;
      };

      const grpcService = new GrpcService(CONFIG, OPTIONS);
      assert.deepEqual(grpcService.grpcMetadata, fakeGrpcMetadata);
    });

    it('should localize maxRetries', () => {
      assert.strictEqual(grpcService.maxRetries, OPTIONS.maxRetries);
    });

    it('should set the correct user-agent', () => {
      const userAgent = 'user-agent/0.0.0';

      fakeUtil.getUserAgentFromPackageJson = packageJson => {
        assert.strictEqual(packageJson, CONFIG.packageJson);
        return userAgent;
      };

      const grpcService = new GrpcService(CONFIG, OPTIONS);
      assert.strictEqual(grpcService.userAgent, userAgent);
    });

    it('should localize the service', () => {
      assert.strictEqual(grpcService.service, CONFIG.service);
    });

    it('should localize an empty Map of services', () => {
      assert(grpcService.activeServiceMap_ instanceof Map);
      assert.strictEqual(grpcService.activeServiceMap_.size, 0);
    });

    it('should call grpc.load correctly', () => {
      grpcLoadOverride = (opts, format, grpcOpts) => {
        assert.strictEqual(opts.root, ROOT_DIR);
        assert.strictEqual(opts.file, PROTO_FILE_PATH);

        assert.strictEqual(format, 'proto');
        assert.deepEqual(grpcOpts, {
          binaryAsBase64: true,
          convertFieldsToCamelCase: true,
        });

        return MOCK_GRPC_API;
      };

      const grpcService = new GrpcService(CONFIG, OPTIONS);
      assert.strictEqual(
        grpcService.protos[CONFIG.service],
        MOCK_GRPC_API.google[CONFIG.service]
      );
    });

    it('should allow proto file paths to be given', () => {
      grpcLoadOverride = opts => {
        assert.strictEqual(opts.root, ROOT_DIR);
        assert.strictEqual(opts.file, '../file/path.proto');

        return MOCK_GRPC_API;
      };

      const config = extend(true, {}, CONFIG, {
        protoServices: {
          Service: '../file/path.proto',
        },
      });

      const grpcService = new GrpcService(config, OPTIONS);
      assert.strictEqual(grpcService.protos.Service, MOCK_GRPC_API.google);
    });

    it('should store the baseUrl properly', () => {
      const fakeBaseUrl = 'a.googleapis.com';

      grpcLoadOverride = () => {
        return MOCK_GRPC_API;
      };

      const config = extend(true, {}, CONFIG, {
        protoServices: {
          CustomServiceName: {
            path: '../file/path.proto',
            baseUrl: fakeBaseUrl,
          },
        },
      });

      const grpcService = new GrpcService(config, OPTIONS);

      assert.strictEqual(
        grpcService.protos.CustomServiceName.baseUrl,
        fakeBaseUrl
      );
    });

    it('should not run in the gcloud sandbox environment', () => {
      (global as any).GCLOUD_SANDBOX_ENV = {};
      const grpcService = new GrpcService();
      assert.strictEqual(grpcService, (global as any).GCLOUD_SANDBOX_ENV);
      delete (global as any).GCLOUD_SANDBOX_ENV;
    });
  });

  describe('decodeValue_', () => {
    it('should decode a struct value', () => {
      const structValue = {
        kind: 'structValue',
        structValue: {},
      };

      const decodedValue = {};

      GrpcService.structToObj_ = () => {
        return decodedValue;
      };

      assert.strictEqual(GrpcService.decodeValue_(structValue), decodedValue);
    });

    it('should decode a null value', () => {
      const nullValue = {
        kind: 'nullValue',
      };

      const decodedValue = null;

      assert.strictEqual(GrpcService.decodeValue_(nullValue), decodedValue);
    });

    it('should decode a list value', () => {
      const listValue = {
        kind: 'listValue',
        listValue: {
          values: [
            {
              kind: 'nullValue',
            },
          ],
        },
      };

      assert.deepEqual(GrpcService.decodeValue_(listValue), [null]);
    });

    it('should return the raw value', () => {
      const numberValue = {
        kind: 'numberValue',
        numberValue: 8,
      };

      assert.strictEqual(GrpcService.decodeValue_(numberValue), 8);
    });
  });

  describe('objToStruct_', () => {
    it('should convert the object using ObjectToStructConverter', () => {
      const options = {};
      const obj = {};

      const convertedObject = {};

      GrpcService.ObjectToStructConverter = options_ => {
        assert.strictEqual(options_, options);

        return {
          convert(obj_) {
            assert.strictEqual(obj_, obj);
            return convertedObject;
          },
        };
      };

      assert.strictEqual(
        GrpcService.objToStruct_(obj, options),
        convertedObject
      );
    });
  });

  describe('structToObj_', () => {
    it('should convert a struct to an object', () => {
      const inputValue = {};
      const decodedValue = {};

      const struct = {
        fields: {
          a: inputValue,
        },
      };

      GrpcService.decodeValue_ = value => {
        assert.strictEqual(value, inputValue);
        return decodedValue;
      };

      assert.deepEqual(GrpcService.structToObj_(struct), {
        a: decodedValue,
      });
    });
  });

  describe('request', () => {
    const PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
    const REQ_OPTS = {reqOpts: true};
    const GRPC_CREDENTIALS = {};

    function ProtoService() {}
    ProtoService.prototype.method = () => {};

    beforeEach(() => {
      grpcService.grpcCredentials = GRPC_CREDENTIALS;

      grpcService.getService_ = () => {
        return ProtoService;
      };
    });

    it('should not run in the gcloud sandbox environment', () => {
      (global as any).GCLOUD_SANDBOX_ENV = true;
      assert.strictEqual(grpcService.request(), (global as any).GCLOUD_SANDBOX_ENV);
      delete (global as any).GCLOUD_SANDBOX_ENV;
    });

    it('should access the specified service proto object', done => {
      retryRequestOverride = util.noop;

      grpcService.getService_ = protoOpts => {
        assert.strictEqual(protoOpts, PROTO_OPTS);
        setImmediate(done);
        return ProtoService;
      };

      grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
    });

    it('should use and return retry-request', () => {
      const retryRequestInstance = {};

      retryRequestOverride = () => {
        return retryRequestInstance;
      };

      const request = grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
      assert.strictEqual(request, retryRequestInstance);
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('getting credentials error', () => {
        const error = new Error('Error.');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ = callback => {
            callback(error);
          };
        });

        it('should execute callback with error', done => {
          grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
            assert.strictEqual(err, error);
            done();
          });
        });
      });

      describe('getting credentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ =callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          grpcService.getService_ = () => {
            assert.strictEqual(grpcService.grpcCredentials, authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
        });
      });
    });

    describe('retry strategy', () => {
      let retryRequestReqOpts;
      let retryRequestOptions;
      let retryRequestCallback;

      beforeEach(() => {
        retryRequestOverride = (reqOpts, options, callback) => {
          retryRequestReqOpts = reqOpts;
          retryRequestOptions = options;
          retryRequestCallback = callback;
        };
      });

      it('should use retry-request', done => {
        const error = {};
        const response = {};

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          assert.strictEqual(err, error);
          assert.strictEqual(resp, response);
          done();
        });

        assert.strictEqual(retryRequestReqOpts, null);
        assert.strictEqual(retryRequestOptions.retries, grpcService.maxRetries);
        assert.strictEqual(retryRequestOptions.currentRetryAttempt, 0);

        retryRequestCallback(error, response);
      });

      it('should retry on 429, 500, 502, and 503', () => {
        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);

        const shouldRetryFn = retryRequestOptions.shouldRetryFn;

        const retryErrors = [{code: 429}, {code: 500}, {code: 502}, {code: 503}];

        const nonRetryErrors = [
          {code: 200},
          {code: 401},
          {code: 404},
          {code: 409},
          {code: 412},
        ];

        assert.strictEqual(retryErrors.every(shouldRetryFn), true);
        assert.strictEqual(nonRetryErrors.every(shouldRetryFn), false);
      });

      it('should treat a retriable error as an HTTP response', done => {
        const grpcError500 = {code: 2};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(grpcError500);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);

        const onResponse = (err, resp) => {
          assert.strictEqual(err, null);
          assert.deepEqual(resp, GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          done();
        };

        retryRequestOptions.request({}, onResponse);
      });

      it('should return grpc request', () => {
        const grpcRequest = {};

        grpcService.getService_ = () => {
          return {
            method() {
              return grpcRequest;
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);

        const request = retryRequestOptions.request();
        assert.strictEqual(request, grpcRequest);
      });

      it('should exec callback with response error as error', done => {
        const grpcError500 = {code: 2};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(grpcError500);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          assert.deepEqual(err, GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          assert.strictEqual(resp, null);
          done();
        });

        // When the gRPC error is passed to "onResponse", it will just invoke
        // the callback passed to retry-request. We will check if the grpc Error
        retryRequestOptions.request({}, retryRequestCallback);
      });

      it('should exec callback with unknown error', done => {
        const unknownError = {a: 'a'};

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts, callback) {
              callback(unknownError, null);
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
          assert.strictEqual(err, unknownError);
          assert.strictEqual(resp, null);
          done();
        });

        // When the gRPC error is passed to "onResponse", it will just invoke
        // the callback passed to retry-request. We will check if the grpc Error
        retryRequestOptions.request({}, retryRequestCallback);
      });
    });

    describe('request option decoration', () => {
      describe('decoration success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            assert.deepEqual(reqOpts, REQ_OPTS);
            return decoratedRequest;
          };

          grpcService.getService_ = () => {
            return {
              method(reqOpts) {
                assert.strictEqual(reqOpts, decoratedRequest);
                done();
              },
            };
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
        });
      });

      describe('decoration error', () => {
        const error = new Error('Error.');

        it('should return a thrown error to the callback', done => {
          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
            assert.strictEqual(err, error);
            done();
          });
        });
      });
    });

    describe('retry request', () => {
      it('should make the correct request on the service', done => {
        grpcService.getService_ = () => {
          return {
            method(reqOpts) {
              assert.deepEqual(reqOpts, REQ_OPTS);
              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
      });

      it('should pass the grpc metadata with the request', done => {
        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata) {
              assert.strictEqual(metadata, grpcService.grpcMetadata);
              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
      });

      it('should set a deadline if a timeout is provided', done => {
        const expectedDeadlineRange = [
          Date.now() + PROTO_OPTS.timeout - 250,
          Date.now() + PROTO_OPTS.timeout + 250,
        ];

        grpcService.getService_ = () => {
          return {
            method(reqOpts, metadata, grpcOpts) {
              assert(is.date(grpcOpts.deadline));

              assert(grpcOpts.deadline.getTime() > expectedDeadlineRange[0]);
              assert(grpcOpts.deadline.getTime() < expectedDeadlineRange[1]);

              done();
            },
          };
        };

        grpcService.request(PROTO_OPTS, REQ_OPTS, assert.ifError);
      });

      describe('request response error', () => {
        it('should look up the http status from the code', () => {
          /*jshint loopfunc:true */
          for (const grpcErrorCode in GrpcService.GRPC_ERROR_CODE_TO_HTTP) {
            const grpcError = {code: grpcErrorCode};
            const httpError = GrpcService.GRPC_ERROR_CODE_TO_HTTP[grpcErrorCode];

            grpcService.getService_ = () => {
              return {
                method(reqOpts, metadata, grpcOpts, callback) {
                  callback(grpcError);
                },
              };
            };

            grpcService.request(PROTO_OPTS, REQ_OPTS, err => {
              assert.strictEqual(err.code, httpError.code);
            });
          }
          /*jshint loopfunc:false */
        });
      });

      describe('request response success', () => {
        const RESPONSE = {};

        beforeEach(() => {
          grpcService.getService_ = () => {
            return {
              method(reqOpts, metadata, grpcOpts, callback) {
                callback(null, RESPONSE);
              },
            };
          };
        });

        it('should execute callback with response', done => {
          grpcService.request(PROTO_OPTS, REQ_OPTS, (err, resp) => {
            assert.ifError(err);
            assert.strictEqual(resp, RESPONSE);
            done();
          });
        });
      });
    });
  });

  describe('requestStream', () => {
    let PROTO_OPTS;
    const REQ_OPTS = {};
    const GRPC_CREDENTIALS = {};
    let fakeStream;

    function ProtoService() {}

    beforeEach(() => {
      PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
      ProtoService.prototype.method = () => {};

      grpcService.grpcCredentials = GRPC_CREDENTIALS;
      grpcService.baseUrl = 'http://base-url';
      grpcService.proto = {};
      grpcService.proto.service = ProtoService;

      grpcService.getService_ = () => {
        return new ProtoService();
      };

      fakeStream = through.obj();
      retryRequestOverride = () => {
        return fakeStream;
      };
    });

    afterEach(() => {
      retryRequestOverride = null;
    });

    it('should not run in the gcloud sandbox environment', () => {
      delete grpcService.grpcCredentials;

      grpcService.getGrpcCredentials_ = () => {
        throw new Error('Should not be called.');
      };

      (global as any).GCLOUD_SANDBOX_ENV = true;
      grpcService.requestStream();
      delete (global as any).GCLOUD_SANDBOX_ENV;
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('credentials error', () => {
        const error = new Error('err');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ =callback => {
            callback(error);
          };
        });

        it('should execute callback with error', done => {
          grpcService
            .requestStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              assert.strictEqual(err, error);
              done();
            });
        });
      });

      describe('credentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ =callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          grpcService.getService_ = () => {
            assert.strictEqual(grpcService.grpcCredentials, authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.requestStream(PROTO_OPTS, REQ_OPTS).on('error', done);
        });
      });
    });

    it('should get the proto service', done => {
      grpcService.getService_ = protoOpts => {
        assert.strictEqual(protoOpts, PROTO_OPTS);
        setImmediate(done);
        return new ProtoService();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS, assert.ifError);
    });

    it('should set the deadline', done => {
      const createDeadline = GrpcService.createDeadline_;
      const fakeDeadline = createDeadline(PROTO_OPTS.timeout);

      GrpcService.createDeadline_ = timeout => {
        assert.strictEqual(timeout, PROTO_OPTS.timeout);
        return fakeDeadline;
      };

      ProtoService.prototype.method = (reqOpts, metadata, grpcOpts) => {
        assert.strictEqual(grpcOpts.deadline, fakeDeadline);

        GrpcService.createDeadline_ = createDeadline;
        setImmediate(done);

        return through.obj();
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should pass the grpc metadata with the request', done => {
      ProtoService.prototype.method = (reqOpts, metadata) => {
        assert.strictEqual(metadata, grpcService.grpcMetadata);
        setImmediate(done);
        return through.obj();
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
    });

    describe('request option decoration', () => {
      beforeEach(() => {
        ProtoService.prototype.method = () => {
          return through.obj();
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };
      });

      describe('requestStream() success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            assert.strictEqual(reqOpts, REQ_OPTS);
            return decoratedRequest;
          };

          ProtoService.prototype.method = reqOpts => {
            assert.strictEqual(reqOpts, decoratedRequest);
            setImmediate(done);
            return through.obj();
          };

          grpcService
            .requestStream(PROTO_OPTS, REQ_OPTS)
            .on('error', assert.ifError);
        });
      });

      describe('requestStream() error', () => {
        it('should end stream with a thrown error', done => {
          const error = new Error('Error.');

          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService
            .requestStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              assert.strictEqual(err, error);
              done();
            });
        });
      });
    });

    describe('retry strategy', () => {
      let retryRequestReqOpts;
      let retryRequestOptions;
      let retryStream;

      beforeEach(() => {
        retryRequestReqOpts = retryRequestOptions = null;
        retryStream = through.obj();

        retryRequestOverride = (reqOpts, options) => {
          retryRequestReqOpts = reqOpts;
          retryRequestOptions = options;
          return retryStream;
        };
      });

      afterEach(() => {
        retryRequestOverride = null;
      });

      it('should use retry-request', () => {
        const reqOpts = extend(
          {
            objectMode: true,
          },
          REQ_OPTS
        );

        grpcService.requestStream(PROTO_OPTS, reqOpts);

        assert.strictEqual(retryRequestReqOpts, null);
        assert.strictEqual(retryRequestOptions.retries, grpcService.maxRetries);
        assert.strictEqual(retryRequestOptions.currentRetryAttempt, 0);
        assert.strictEqual(retryRequestOptions.objectMode, true);
        assert.strictEqual(
          retryRequestOptions.shouldRetryFn,
          GrpcService.shouldRetryRequest_
        );
      });

      it('should emit the metadata event as a response event', done => {
        const fakeStream = through.obj();

        ProtoService.prototype.method = () => {
          return fakeStream;
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };

        fakeStream.on('error', done).on('response', resp => {
          assert.deepEqual(resp, GrpcService.GRPC_ERROR_CODE_TO_HTTP[0]);
          done();
        });

        grpcService.requestStream(PROTO_OPTS, REQ_OPTS);
        fakeStream.emit('metadata');
      });

      it('should forward `request` events', done => {
        const requestStream = grpcService.requestStream(PROTO_OPTS, REQ_OPTS);

        requestStream.on('request', () => {
          done();
        });

        retryStream.emit('request');
      });

      it('should emit the response error', done => {
        const grpcError500 = {code: 2};
        const requestStream = grpcService.requestStream(PROTO_OPTS, REQ_OPTS);

        requestStream.destroy = err => {
          assert.deepEqual(err, GrpcService.GRPC_ERROR_CODE_TO_HTTP[2]);
          done();
        };

        retryStream.emit('error', grpcError500);
      });
    });
  });

  describe('requestWritableStream', () => {
    let PROTO_OPTS;
    const REQ_OPTS = {};
    const GRPC_CREDENTIALS = {};

    function ProtoService() {}

    beforeEach(() => {
      PROTO_OPTS = {service: 'service', method: 'method', timeout: 3000};
      ProtoService.prototype.method = () => {};

      grpcService.grpcCredentials = GRPC_CREDENTIALS;
      grpcService.baseUrl = 'http://base-url';
      grpcService.proto = {};
      grpcService.proto.service = ProtoService;

      grpcService.getService_ = () => {
        return new ProtoService();
      };
    });

    it('should not run in the gcloud sandbox environment', () => {
      delete grpcService.grpcCredentials;

      grpcService.getGrpcCredentials_ = () => {
        throw new Error('Should not be called.');
      };

      (global as any).GCLOUD_SANDBOX_ENV = true;
      grpcService.requestWritableStream({});

      delete (global as any).GCLOUD_SANDBOX_ENV;
    });

    it('should get the proto service', done => {
      ProtoService.prototype.method = () => {
        return (duplexify as any).obj();
      };
      grpcService.getService_ = protoOpts => {
        assert.strictEqual(protoOpts, PROTO_OPTS);
        setImmediate(done);
        return new ProtoService();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should set the deadline', done => {
      const createDeadline = GrpcService.createDeadline_;
      const fakeDeadline = createDeadline(PROTO_OPTS.timeout);

      GrpcService.createDeadline_ = timeout => {
        assert.strictEqual(timeout, PROTO_OPTS.timeout);
        return fakeDeadline;
      };

      ProtoService.prototype.method = (reqOpts, metadata, grpcOpts) => {
        assert.strictEqual(grpcOpts.deadline, fakeDeadline);

        GrpcService.createDeadline_ = createDeadline;
        setImmediate(done);

        return through.obj();
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    it('should pass the grpc metadata with the request', done => {
      ProtoService.prototype.method = (reqOpts, metadata) => {
        assert.strictEqual(metadata, grpcService.grpcMetadata);
        setImmediate(done);
        return through.obj();
      };

      retryRequestOverride = (_, retryOpts) => {
        return retryOpts.request();
      };

      grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
    });

    describe('getting gRPC credentials', () => {
      beforeEach(() => {
        delete grpcService.grpcCredentials;
      });

      describe('grpcCredentials error', () => {
        const error = new Error('err');

        beforeEach(() => {
          grpcService.getGrpcCredentials_ =callback => {
            setImmediate(() => {
              callback(error);
            });
          };
        });

        it('should execute callback with error', done => {
          grpcService
            .requestWritableStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              assert.strictEqual(err, error);
              done();
            });
        });
      });

      describe('grpcCredentials success', () => {
        const authClient = {};

        beforeEach(() => {
          grpcService.getGrpcCredentials_ =callback => {
            callback(null, authClient);
          };
        });

        it('should make the gRPC request again', done => {
          const stream = (duplexify as any).obj();
          ProtoService.prototype.method = () => {
            return stream;
          };
          grpcService.getService_ = () => {
            assert.strictEqual(grpcService.grpcCredentials, authClient);
            setImmediate(done);
            return new ProtoService();
          };

          grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
        });
      });
    });

    describe('request option decoration', () => {
      beforeEach(() => {
        ProtoService.prototype.method = () => {
          return through.obj();
        };

        retryRequestOverride = (reqOpts, options) => {
          return options.request();
        };
      });

      describe('requestWritableStream() success', () => {
        it('should decorate the request', done => {
          const decoratedRequest = {};

          grpcService.decorateRequest_ = reqOpts => {
            assert.strictEqual(reqOpts, REQ_OPTS);
            return decoratedRequest;
          };

          ProtoService.prototype.method = reqOpts => {
            assert.strictEqual(reqOpts, decoratedRequest);
            setImmediate(done);
            return through.obj();
          };

          grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);
        });
      });

      describe('requestWritableStream() error', () => {
        const error = new Error('Error.');

        it('should end stream with a thrown error', done => {
          grpcService.decorateRequest_ = () => {
            throw error;
          };

          grpcService
            .requestWritableStream(PROTO_OPTS, REQ_OPTS)
            .on('error', err => {
              assert.strictEqual(err, error);
              done();
            });
        });
      });
    });

    describe('stream success', () => {
      const authClient = {};

      beforeEach(() => {
        delete grpcService.grpcCredentials;
        grpcService.getGrpcCredentials_ =callback => {
          callback(null, authClient);
        };
        sinon.spy(GrpcService, 'decorateStatus_');
      });

      it('should emit response', done => {
        const stream = (duplexify as any).obj();
        ProtoService.prototype.method = () => {
          return stream;
        };
        grpcService.getService_ = () => {
          assert.strictEqual(grpcService.grpcCredentials, authClient);
          return new ProtoService();
        };

        grpcService
          .requestWritableStream(PROTO_OPTS, REQ_OPTS)
          .on('response', status =>  {
            assert.equal(status, 'foo');
            assert.equal(GrpcService.decorateStatus_.callCount, 1);
            assert(GrpcService.decorateStatus_.calledWith('foo'));
            GrpcService.decorateStatus_.restore();
            done();
          })
          .on('error', done);

        setImmediate(() => {
          stream.emit('status', 'foo');
        });
      });
    });

    describe('stream error', () => {
      const authClient = {};

      beforeEach(() => {
        delete grpcService.grpcCredentials;
        grpcService.getGrpcCredentials_ =callback => {
          callback(null, authClient);
        };
      });

      it('should emit a decorated error', done => {
        const grpcStream = (duplexify as any).obj();
        ProtoService.prototype.method = () => {
          return grpcStream;
        };
        grpcService.getService_ = () => {
          assert.strictEqual(grpcService.grpcCredentials, authClient);
          return new ProtoService();
        };

        const error = new Error('Error.');
        const expectedDecoratedError = new Error('Decorated error.');

        sinon.stub(GrpcService, 'decorateError_').callsFake(() => {
          return expectedDecoratedError;
        });

        const stream = grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);

        stream.on('error', err => {
          assert.strictEqual(err, expectedDecoratedError);
          assert.equal(GrpcService.decorateError_.callCount, 1);
          assert(GrpcService.decorateError_.calledWith(error));
          GrpcService.decorateError_.restore();
          done();
        });

        setImmediate(() => {
          grpcStream.emit('error', error);
        });
      });

      it('should emit the original error', done => {
        const grpcStream = (duplexify as any).obj();
        ProtoService.prototype.method = () => {
          return grpcStream;
        };
        grpcService.getService_ = () => {
          assert.strictEqual(grpcService.grpcCredentials, authClient);
          return new ProtoService();
        };

        const error = new Error('Error.');

        sinon.stub(GrpcService, 'decorateError_').callsFake(() => {
          return null;
        });

        const stream = grpcService.requestWritableStream(PROTO_OPTS, REQ_OPTS);

        stream.on('error', err => {
          assert.strictEqual(err, error);
          assert.equal(GrpcService.decorateError_.callCount, 1);
          assert(GrpcService.decorateError_.calledWith(error));
          GrpcService.decorateError_.restore();
          done();
        });

        setImmediate(() => {
          grpcStream.emit('error', error);
        });
      });
    });
  });

  describe('encodeValue_', () => {
    it('should encode value using ObjectToStructConverter fn', () => {
      const obj = {};

      const convertedObject = {};

      GrpcService.ObjectToStructConverter = () => {
        return {
          encodeValue_(obj_) {
            assert.strictEqual(obj_, obj);
            return convertedObject;
          },
        };
      };

      assert.strictEqual(GrpcService.encodeValue_(obj), convertedObject);
    });
  });

  describe('createDeadline_', () => {
    const nowTimestamp = Date.now();
    let now;

    before(() => {
      now = Date.now;

      Date.now = () => {
        return nowTimestamp;
      };
    });

    after(() => {
      Date.now = now;
    });

    it('should create a deadline', () => {
      const timeout = 3000;
      const deadline = GrpcService.createDeadline_(timeout);

      assert.strictEqual(deadline.getTime(), nowTimestamp + timeout);
    });
  });

  describe('decorateError_', () => {
    const expectedDecoratedError = new Error('err.');

    beforeEach(() => {
      sinon.stub(GrpcService, 'decorateGrpcResponse_').callsFake(() => {
        return expectedDecoratedError;
      });
    });

    it('should decorate an Error object', () => {
      const grpcError = new Error('Hello');
      (grpcError as any).code = 2;

      const decoratedError = GrpcService.decorateError_(grpcError);
      const decorateArgs = GrpcService.decorateGrpcResponse_.getCall(0).args;

      assert.strictEqual(decoratedError, expectedDecoratedError);
      assert.strictEqual(decorateArgs[0] instanceof Error, true);
      assert.strictEqual(decorateArgs[1], grpcError);
    });

    it('should decorate a plain object', () => {
      const grpcMessage = {code: 2};

      const decoratedError = GrpcService.decorateError_(grpcMessage);
      const decorateArgs = GrpcService.decorateGrpcResponse_.getCall(0).args;

      assert.strictEqual(decoratedError, expectedDecoratedError);
      assert.deepEqual(decorateArgs[0], {});
      assert.strictEqual(decorateArgs[0] instanceof Error, false);
      assert.strictEqual(decorateArgs[1], grpcMessage);
    });
  });

  describe('decorateGrpcResponse_', () => {
    it('should retrieve the HTTP code from the gRPC error map', () => {
      const errorMap = GrpcService.GRPC_ERROR_CODE_TO_HTTP;
      const codes = Object.keys(errorMap);

      codes.forEach(code => {
        const error = new Error();
        const extended = GrpcService.decorateGrpcResponse_(error, {code});

        assert.notStrictEqual(extended, errorMap[code]);
        assert.deepEqual(extended, errorMap[code]);
        assert.strictEqual(error, extended);
      });
    });

    it('should use the message from the error', () => {
      const errorMessage = 'This is an error message.';

      const err = {
        code: 1,
        message: errorMessage,
      };

      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, err);

      assert.strictEqual(extended.message, errorMessage);
    });

    it('should use a stringified JSON message from the error', () => {
      const errorMessage = 'This is an error message.';

      const err = {
        code: 1,
        message: JSON.stringify({
          description: errorMessage,
        }),
      };

      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, err);

      assert.strictEqual(extended.message, errorMessage);
    });

    it('should return null for unknown errors', () => {
      const error = new Error();
      const extended = GrpcService.decorateGrpcResponse_(error, {code: 9999});

      assert.strictEqual(extended, null);
    });
  });

  describe('decorateStatus_', () => {
    const fakeStatus = {status: 'a'};

    beforeEach(() => {
      sinon.stub(GrpcService, 'decorateGrpcResponse_').callsFake(() => {
        return fakeStatus;
      });
    });

    it('should call decorateGrpcResponse_ with an object', () => {
      const grpcStatus = {code: 2};

      const status = GrpcService.decorateStatus_(grpcStatus);
      const args = GrpcService.decorateGrpcResponse_.getCall(0).args;

      assert.strictEqual(status, fakeStatus);
      assert.deepEqual(args[0], {});
      assert.strictEqual(args[1], grpcStatus);
    });
  });

  describe('shouldRetryRequest_', () => {
    it('should retry on 429, 500, 502, and 503', () => {
      const shouldRetryFn = GrpcService.shouldRetryRequest_;

      const retryErrors = [{code: 429}, {code: 500}, {code: 502}, {code: 503}];

      const nonRetryErrors = [
        {code: 200},
        {code: 401},
        {code: 404},
        {code: 409},
        {code: 412},
      ];

      assert.strictEqual(retryErrors.every(shouldRetryFn), true);
      assert.strictEqual(nonRetryErrors.every(shouldRetryFn), false);
    });
  });

  describe('decorateRequest_', () => {
    it('should delete custom API values without modifying object', () => {
      const reqOpts = {
        autoPaginate: true,
        autoPaginateVal: true,
        objectMode: true,
      };

      const originalReqOpts = extend({}, reqOpts);

      assert.deepEqual(grpcService.decorateRequest_(reqOpts), {});
      assert.deepEqual(reqOpts, originalReqOpts);
    });

    it('should execute and return replaceProjectIdToken', () => {
      const reqOpts = {
        a: 'b',
        c: 'd',
      };

      const replacedReqOpts = {};

      fakeUtil.replaceProjectIdToken = (reqOpts_, projectId) => {
        assert.deepEqual(reqOpts_, reqOpts);
        assert.strictEqual(projectId, grpcService.projectId);
        return replacedReqOpts;
      };

      assert.strictEqual(
        grpcService.decorateRequest_(reqOpts),
        replacedReqOpts
      );
    });
  });

  describe('getGrpcCredentials_', () => {
    it('should get credentials from the auth client', done => {
      grpcService.authClient = {
        async getClient() {
          done();
        },
      };

      grpcService.getGrpcCredentials_(assert.ifError);
    });

    describe('credential fetching error', () => {
      const error = new Error('Error.');

      beforeEach(() => {
        grpcService.authClient = {
          async getClient() {
            throw error;
          },
        };
      });

      it('should execute callback with error', done => {
        grpcService.getGrpcCredentials_(err => {
          assert.strictEqual(err, error);
          done();
        });
      });
    });

    describe('credential fetching success', () => {
      const AUTH_CLIENT = {
        projectId: 'project-id',
      };

      beforeEach(() => {
        grpcService.authClient = {
          async getClient() {
            return AUTH_CLIENT;
          }
        };
      });

      it('should return grpcCredentials', done => {
        grpcService.getGrpcCredentials_((err, grpcCredentials) => {
          assert.ifError(err);

          assert.strictEqual(grpcCredentials.name, 'combineChannelCredentials');

          const createSslArg = grpcCredentials.args[0];
          assert.strictEqual(createSslArg.name, 'createSsl');
          assert.deepEqual(createSslArg.args.length, 0);

          const createFromGoogleCredentialArg = grpcCredentials.args[1];
          assert.strictEqual(
            createFromGoogleCredentialArg.name,
            'createFromGoogleCredential'
          );
          assert.strictEqual(createFromGoogleCredentialArg.args[0], AUTH_CLIENT);
          done();
        });
      });

      it('should set projectId', done => {
        grpcService.getGrpcCredentials_(err => {
          assert.ifError(err);
          assert.strictEqual(grpcService.projectId, AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should not change projectId that was already set', done => {
        grpcService.projectId = 'project-id';

        grpcService.getGrpcCredentials_(err => {
          assert.ifError(err);
          assert.strictEqual(grpcService.projectId, AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should change placeholder projectId', done => {
        grpcService.projectId = '{{projectId}}';

        grpcService.getGrpcCredentials_(err => {
          assert.ifError(err);
          assert.strictEqual(grpcService.projectId, AUTH_CLIENT.projectId);
          done();
        });
      });

      it('should not update projectId if it was not found', done => {
        grpcService.projectId = 'project-id';

        grpcService.authClient = {
          async getClient() {
            return {
              projectId: undefined,
            };
          },
        };

        grpcService.getGrpcCredentials_(err => {
          assert.ifError(err);
          assert.strictEqual(grpcService.projectId, grpcService.projectId);
          done();
        });
      });
    });
  });

  describe('loadProtoFile_', () => {
    const fakeServices = {
      google: {
        FakeService: {},
      },
    };

    it('should load a proto file', () => {
      const fakeProtoConfig = {
        path: '/root/dir/path',
        service: 'FakeService',
      };

      const fakeMainConfig = {
        protosDir: ROOT_DIR,
      };

      grpcLoadOverride = (pathOpts, type, grpOpts) => {
        assert.strictEqual(pathOpts.root, fakeMainConfig.protosDir);
        assert.strictEqual(pathOpts.file, fakeProtoConfig.path);
        assert.strictEqual(type, 'proto');

        assert.deepEqual(grpOpts, {
          binaryAsBase64: true,
          convertFieldsToCamelCase: true,
        });

        return fakeServices;
      };

      const service = grpcService.loadProtoFile_(fakeProtoConfig, fakeMainConfig);
      assert.strictEqual(service, fakeServices.google.FakeService);
    });

    it('should cache the expensive proto object creation', () => {
      const protoConfig = {
        path: '/root/dir/path',
        service: 'FakeService',
      };

      const mainConfig = {
        service: 'OtherFakeService',
        apiVersion: 'v2',
      };

      let gprcLoadCalled = 0;
      grpcLoadOverride = () => {
        gprcLoadCalled++;
        return fakeServices;
      };

      const service1 = grpcService.loadProtoFile_(protoConfig, mainConfig);
      const service2 = grpcService.loadProtoFile_(protoConfig, mainConfig);
      assert.strictEqual(service1, service2);
      assert.strictEqual(gprcLoadCalled, 1);
    });

    it('should return the services object if invalid version', () => {
      const fakeProtoConfig = {
        path: '/root/dir/path',
        service: 'FakeService',
        apiVersion: null,
      };

      const fakeMainConfig = {
        service: 'OtherFakeService',
        apiVersion: 'v2',
      };

      grpcLoadOverride = () => {
        return fakeServices;
      };

      const service = grpcService.loadProtoFile_(fakeProtoConfig, fakeMainConfig);
      assert.strictEqual(service, fakeServices.google.FakeService);
    });
  });

  describe('getService_', () => {
    it('should get a new service instance', () => {
      const fakeService = {};

      grpcService.protos = {
        Service: {
          Service(baseUrl, grpcCredentials, userAgent) {
            assert.strictEqual(baseUrl, grpcService.baseUrl);
            assert.strictEqual(grpcCredentials, grpcService.grpcCredentials);
            assert.deepEqual(
              userAgent,
              extend(
                {
                  'grpc.primary_user_agent': grpcService.userAgent,
                },
                GrpcService.GRPC_SERVICE_OPTIONS
              )
            );

            return fakeService;
          },
        },
      };

      const service = grpcService.getService_({service: 'Service'});
      assert.strictEqual(service, fakeService);

      const cachedService = grpcService.activeServiceMap_.get('Service');
      assert.strictEqual(cachedService, fakeService);
    });

    it('should return the cached version of a service', () => {
      const fakeService = {};

      grpcService.protos = {
        Service: {
          Service() {
            throw new Error('should not be called');
          },
        },
      };

      grpcService.activeServiceMap_.set('Service', fakeService);

      const service = grpcService.getService_({service: 'Service'});
      assert.strictEqual(service, fakeService);

      const cachedService = grpcService.activeServiceMap_.get('Service');
      assert.strictEqual(cachedService, fakeService);
    });

    it('should use the baseUrl override if applicable', () => {
      const fakeBaseUrl = 'a.googleapis.com';
      const fakeService = {};

      grpcService.protos = {
        Service: {
          baseUrl: fakeBaseUrl,
          Service(baseUrl) {
            assert.strictEqual(baseUrl, fakeBaseUrl);
            return fakeService;
          },
        },
      };

      const service = grpcService.getService_({service: 'Service'});
      assert.strictEqual(service, fakeService);
    });
  });

  describe('ObjectToStructConverter', () => {
    let objectToStructConverter;

    beforeEach(() => {
      objectToStructConverter = new ObjectToStructConverter(OPTIONS);
    });

    describe('instantiation', () => {
      it('should not require an options object', () => {
        assert.doesNotThrow(() => {
          new ObjectToStructConverter();
        });
      });

      it('should localize an empty Set for seenObjects', () => {
        assert(objectToStructConverter.seenObjects instanceof Set);
        assert.strictEqual(objectToStructConverter.seenObjects.size, 0);
      });

      it('should localize options', () => {
        const objectToStructConverter = new ObjectToStructConverter({
          removeCircular: true,
          stringify: true,
        });

        assert.strictEqual(objectToStructConverter.removeCircular, true);
        assert.strictEqual(objectToStructConverter.stringify, true);
      });

      it('should set correct defaults', () => {
        assert.strictEqual(objectToStructConverter.removeCircular, false);
        assert.strictEqual(objectToStructConverter.stringify, false);
      });
    });

    describe('convert', () => {
      it('should encode values in an Object', () => {
        const inputValue = {};
        const convertedValue = {};

        objectToStructConverter.encodeValue_ = value => {
          assert.strictEqual(value, inputValue);
          return convertedValue;
        };

        const struct = objectToStructConverter.convert({
          a: inputValue,
        });

        assert.strictEqual(struct.fields.a, convertedValue);
      });

      it('should not include undefined values', done => {
        objectToStructConverter.encodeValue_ = () => {
          done(new Error('Should not be called'));
        };

        const struct = objectToStructConverter.convert({
          a: undefined,
        });

        assert.deepEqual(struct.fields, {});

        done();
      });

      it('should add seen objects to set then empty set', done => {
        const obj = {};
        let objectAdded;

        objectToStructConverter.seenObjects = {
          add(obj) {
            objectAdded = obj;
          },
          delete(obj_) {
            assert.strictEqual(obj_, obj);
            assert.strictEqual(objectAdded, obj);
            done();
          },
        };

        objectToStructConverter.convert(obj);
      });
    });

    describe('encodeValue_', () => {
      it('should convert primitive values correctly', () => {
        const buffer = Buffer.from('Value');

        assert.deepEqual(objectToStructConverter.encodeValue_(null), {
          nullValue: 0,
        });

        assert.deepEqual(objectToStructConverter.encodeValue_(1), {
          numberValue: 1,
        });

        assert.deepEqual(objectToStructConverter.encodeValue_('Hi'), {
          stringValue: 'Hi',
        });

        assert.deepEqual(objectToStructConverter.encodeValue_(true), {
          boolValue: true,
        });

        assert.strictEqual(
          objectToStructConverter.encodeValue_(buffer).blobValue.toString(),
          'Value'
        );
      });

      it('should convert arrays', () => {
        const convertedValue = objectToStructConverter.encodeValue_([1, 2, 3]);

        assert.deepEqual(convertedValue.listValue, {
          values: [
            objectToStructConverter.encodeValue_(1),
            objectToStructConverter.encodeValue_(2),
            objectToStructConverter.encodeValue_(3),
          ],
        });
      });

      it('should throw if a type is not recognized', () => {
        assert.throws(() => {
          objectToStructConverter.encodeValue_();
        }, /Value of type undefined not recognized./);
      });

      describe('objects', () => {
        const VALUE: any = {};
        VALUE.circularReference = VALUE;

        it('should convert objects', () => {
          const convertedValue = {};

          objectToStructConverter.convert = value => {
            assert.strictEqual(value, VALUE);
            return convertedValue;
          };

          assert.deepStrictEqual(objectToStructConverter.encodeValue_(VALUE), {
            structValue: convertedValue,
          });
        });

        describe('circular references', () => {
          it('should throw if circular', () => {
            const errorMessage = [
              'This object contains a circular reference. To automatically',
              'remove it, set the `removeCircular` option to true.',
            ].join(' ');

            objectToStructConverter.seenObjects.add(VALUE);

            assert.throws(() => {
              objectToStructConverter.encodeValue_(VALUE);
            }, new RegExp(errorMessage));
          });

          describe('options.removeCircular', () => {
            let objectToStructConverter;

            beforeEach(() => {
              objectToStructConverter = new ObjectToStructConverter({
                removeCircular: true,
              });

              objectToStructConverter.seenObjects.add(VALUE);
            });

            it('should replace circular reference with [Circular]', () => {
              assert.deepStrictEqual(
                objectToStructConverter.encodeValue_(VALUE),
                {stringValue: '[Circular]'}
              );
            });
          });
        });
      });

      describe('options.stringify', () => {
        let objectToStructConverter;

        beforeEach(() => {
          objectToStructConverter = new ObjectToStructConverter({
            stringify: true,
          });
        });

        it('should return a string if the value is not recognized', () => {
          const date = new Date();

          assert.deepEqual(
            objectToStructConverter.encodeValue_(date, OPTIONS),
            {stringValue: String(date)}
          );
        });
      });
    });
  });
});
