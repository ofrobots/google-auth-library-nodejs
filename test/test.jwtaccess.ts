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
import * as fs from 'fs';
import * as http from 'http';
import * as jws from 'jws';

import {JWTInput} from '../src/auth/credentials';
import {GoogleAuth} from '../src/auth/googleauth';
import {JWTAccess} from '../src/auth/jwtaccess';

const keypair = require('keypair');

// Creates a standard JSON credentials object for testing.
function createJSON() {
  return {
    private_key_id: 'key123',
    private_key: 'privatekey',
    client_email: 'hello@youarecool.com',
    client_id: 'client123',
    type: 'service_account'
  };
}

describe('.getRequestMetadata', () => {

  it('create a signed JWT token as the access token', (done) => {
    const keys = keypair(1024 /* bitsize of private key */);
    const testUri = 'http:/example.com/my_test_service';
    const email = 'foo@serviceaccount.com';
    const auth = new GoogleAuth();
    const client = new auth.JWTAccess(email, keys.private);

    const retValue = 'dummy';
    const expectAuth =
        (err: Error|null, headers?: http.IncomingHttpHeaders|null) => {
          assert.strictEqual(null, err, 'no error was expected: got\n' + err);
          assert.notStrictEqual(
              null, headers, 'an creds object should be present');
          if (headers) {
            const decoded = jws.decode(
                (headers.Authorization as string).replace('Bearer ', ''));
            const payload = JSON.parse(decoded.payload);
            assert.strictEqual(email, payload.iss);
            assert.strictEqual(email, payload.sub);
            assert.strictEqual(testUri, payload.aud);
          }
          done();
          return retValue;
        };
    const res = client.getRequestMetadata(testUri, expectAuth);
    assert.strictEqual(res, retValue);
  });

});

describe('.createScopedRequired', () => {
  it('should return false', () => {
    const auth = new GoogleAuth();
    const client = new auth.JWTAccess('foo@serviceaccount.com', null);
    assert.equal(false, client.createScopedRequired());
  });
});

describe('.fromJson', () => {
  // set up the test json and the client instance being tested.
  let json = ({} as JWTInput);
  let client: JWTAccess;
  beforeEach(() => {
    json = createJSON();
    const auth = new GoogleAuth();
    client = new auth.JWTAccess();
  });

  it('should error on null json', (done) => {
    // Test verifies invalid parameter tests, which requires cast to any.
    // tslint:disable-next-line no-any
    (client as any).fromJSON(null, (err: Error) => {
      assert.equal(true, err instanceof Error);
      done();
    });
  });

  it('should error on empty json', (done) => {
    client.fromJSON({}, (err) => {
      assert.equal(true, err instanceof Error);
      done();
    });
  });

  it('should error on missing client_email', (done) => {
    delete json.client_email;

    client.fromJSON(json, (err) => {
      assert.equal(true, err instanceof Error);
      done();
    });
  });

  it('should error on missing private_key', (done) => {
    delete json.private_key;

    client.fromJSON(json, (err) => {
      assert.equal(true, err instanceof Error);
      done();
    });
  });

  it('should create JWT with client_email', (done) => {
    client.fromJSON(json, (err) => {
      assert.equal(null, err);
      assert.equal(json.client_email, client.email);
      done();
    });
  });

  it('should create JWT with private_key', (done) => {
    client.fromJSON(json, (err) => {
      assert.equal(null, err);
      assert.equal(json.private_key, client.key);
      done();
    });
  });

});

describe('.fromStream', () => {
  // set up the client instance being tested.
  let client: JWTAccess;
  beforeEach(() => {
    const auth = new GoogleAuth();
    client = new auth.JWTAccess();
  });

  it('should error on null stream', (done) => {
    // Test verifies invalid parameter tests, which requires cast to any.
    // tslint:disable-next-line no-any
    (client as any).fromStream(null, (err: Error) => {
      assert.equal(true, err instanceof Error);
      done();
    });
  });

  it('should construct a JWT Header instance from a stream', (done) => {
    // Read the contents of the file into a json object.
    const fileContents =
        fs.readFileSync('./test/fixtures/private.json', 'utf-8');
    const json = JSON.parse(fileContents);

    // Now open a stream on the same file.
    const stream = fs.createReadStream('./test/fixtures/private.json');

    // And pass it into the fromStream method.
    client.fromStream(stream, (err) => {
      assert.equal(null, err);

      // Ensure that the correct bits were pulled from the stream.
      assert.equal(json.private_key, client.key);
      assert.equal(json.client_email, client.email);
      done();
    });
  });

});
