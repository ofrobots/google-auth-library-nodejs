/**
 * Copyright 2013 Google Inc. All Rights Reserved.
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

import * as assert from 'assert';
import * as nock from 'nock';
import * as request from 'request';

import {Compute} from '../src/auth/computeclient';
import {Credentials} from '../src/auth/credentials';
import {GoogleAuth} from '../src/auth/googleauth';

nock.disableNetConnect();

describe('Initial credentials', () => {

  it('should create a dummy refresh token string', () => {
    // It is important that the compute client is created with a refresh token
    // value filled in, or else the rest of the logic will not work.
    const auth = new GoogleAuth();
    const compute = new auth.Compute();
    assert.equal('compute-placeholder', compute.credentials.refresh_token);
  });
});

describe('Compute auth client', () => {
  // set up compute client.
  let compute: Compute;
  beforeEach(() => {
    const auth = new GoogleAuth();
    compute = new auth.Compute();
  });

  it('should get an access token for the first request', done => {
    const scope =
        nock('http://metadata.google.internal')
            .get(
                '/computeMetadata/v1beta1/instance/service-accounts/default/token')
            .reply(200, {access_token: 'abc123', expires_in: 10000});
    compute.request({uri: 'http://foo'}, () => {
      assert.equal(compute.credentials.access_token, 'abc123');
      scope.done();
      done();
    });
  });

  it('should refresh if access token has expired', (done) => {
    const scope =
        nock('http://metadata.google.internal')
            .get(
                '/computeMetadata/v1beta1/instance/service-accounts/default/token')
            .reply(200, {access_token: 'abc123', expires_in: 10000});
    compute.credentials.access_token = 'initial-access-token';
    compute.credentials.expiry_date = (new Date()).getTime() - 10000;
    compute.request({uri: 'http://foo'}, () => {
      assert.equal(compute.credentials.access_token, 'abc123');
      scope.done();
      done();
    });
  });

  it('should not refresh if access token has not expired', (done) => {
    const scope =
        nock('http://metadata.google.internal')
            .get(
                '/computeMetadata/v1beta1/instance/service-accounts/default/token')
            .reply(200, {access_token: 'abc123', expires_in: 10000});
    compute.credentials.access_token = 'initial-access-token';
    compute.credentials.expiry_date = (new Date()).getTime() + 10000;
    compute.request({uri: 'http://foo'}, () => {
      assert.equal(compute.credentials.access_token, 'initial-access-token');
      assert.equal(false, scope.isDone());
      nock.cleanAll();
      done();
    });
  });

  describe('.createScopedRequired', () => {
    it('should return false', () => {
      const auth = new GoogleAuth();
      const c = new auth.Compute();
      assert.equal(false, c.createScopedRequired());
    });
  });

  describe('._injectErrorMessage', () => {
    it('should return a helpful message on request response.statusCode 403', done => {
      // Mock the credentials object.
      compute.credentials = {
        refresh_token: 'hello',
        access_token: 'goodbye',
        expiry_date: (new Date(9999, 1, 1)).getTime()
      };

      // Mock the _makeRequest method to return a 403.
      compute._makeRequest = (opts, callback) => {
        callback(
            null, 'a weird response body',
            {statusCode: 403} as request.RequestResponse);
        return {} as request.Request;
      };

      compute.request(({} as request.OptionsWithUrl), (err, result, response) => {
        assert(response);
        assert.equal(403, response ? response.statusCode : 0);
        assert.equal(
            'A Forbidden error was returned while attempting to retrieve an access ' +
                'token for the Compute Engine built-in service account. This may be because the ' +
                'Compute Engine instance does not have the correct permission scopes specified.',
            err ? err.message : null);
        done();
      });
    });

    it('should return a helpful message on request response.statusCode 404', (done) => {
      // Mock the credentials object.
      compute.credentials = {
        refresh_token: 'hello',
        access_token: 'goodbye',
        expiry_date: (new Date(9999, 1, 1)).getTime()
      };

      // Mock the _makeRequest method to return a 404.
      compute._makeRequest = (opts, callback) => {
        callback(
            null, 'a weird response body',
            {statusCode: 404} as request.RequestResponse);
        return {} as request.Request;
      };

      compute.request(({} as request.OptionsWithUri), (err, result, response) => {
        assert.equal(404, response ? response.statusCode : 0);
        assert.equal(
            'A Not Found error was returned while attempting to retrieve an access' +
                'token for the Compute Engine built-in service account. This may be because the ' +
                'Compute Engine instance does not have any permission scopes specified.',
            err ? err.message : null);
        done();
      });
    });

    it('should return a helpful message on token refresh response.statusCode 403',
       (done) => {
         nock('http://metadata.google.internal')
             .get(
                 '/computeMetadata/v1beta1/instance/service-accounts/default/token')
             .reply(403, 'a weird response body');

         // Mock the credentials object with a null access token, to force a
         // refresh.
         compute.credentials = {
           refresh_token: 'hello',
           access_token: undefined,
           expiry_date: 1
         };

         compute.request(({} as request.OptionsWithUri), (err, result, response) => {
           assert.equal(403, response ? response.statusCode : null);
           assert.equal(
               'A Forbidden error was returned while attempting to retrieve an access ' +
                   'token for the Compute Engine built-in service account. This may be because the ' +
                   'Compute Engine instance does not have the correct permission scopes specified. ' +
                   'Could not refresh access token.',
               err ? err.message : null);
           nock.cleanAll();
           done();
         });
       });

    it('should return a helpful message on token refresh response.statusCode 404', done => {
      nock('http://metadata.google.internal')
          .get(
              '/computeMetadata/v1beta1/instance/service-accounts/default/token')
          .reply(404, 'a weird body');

      // Mock the credentials object with a null access token, to force a
      // refresh.
      compute.credentials = {
        refresh_token: 'hello',
        access_token: undefined,
        expiry_date: 1
      } as Credentials;

      compute.request(({} as request.OptionsWithUri), (err, result, response) => {
        assert.equal(404, response ? response.statusCode : null);
        assert.equal(
            'A Not Found error was returned while attempting to retrieve an access' +
                'token for the Compute Engine built-in service account. This may be because the ' +
                'Compute Engine instance does not have any permission scopes specified. Could not ' +
                'refresh access token.',
            err ? err.message : null);
        done();
      });
    });
  });
});
