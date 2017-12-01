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
import {GoogleAuth} from '../src/auth/googleauth';
import {IAMAuth, RequestMetadata} from '../src/auth/iam';

describe('.getRequestMetadata', () => {
  const testSelector = 'a-test-selector';
  const testToken = 'a-test-token';
  let client: IAMAuth;
  beforeEach(() => {
    const auth = new GoogleAuth();
    client = new auth.IAMAuth(testSelector, testToken);
  });

  it('passes the token and selector to the callback ', (done) => {
    const expectRequestMetadata =
        (err: Error|null, creds?: RequestMetadata) => {
          assert.strictEqual(err, null, 'no error was expected: got\n' + err);
          assert.notStrictEqual(creds, null, 'metadata should be present');
          if (creds) {
            assert.strictEqual(
                creds['x-goog-iam-authority-selector'], testSelector);
            assert.strictEqual(
                creds['x-goog-iam-authorization-token'], testToken);
          }
          done();
        };
    client.getRequestMetadata(null, expectRequestMetadata);
  });
});
