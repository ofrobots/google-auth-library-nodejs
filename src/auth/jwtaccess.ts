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

import * as jws from 'jws';
import * as stream from 'stream';
import {JWTInput} from './credentials';
import {RequestMetadataCallback, RequestMetadataResponse} from './oauth2client';

export class JWTAccess {
  email?: string|null;
  key?: string|null;
  projectId?: string;

  /**
   * JWTAccess service account credentials.
   *
   * Create a new access token by using the credential to create a new JWT token
   * that's recognized as the access token.
   *
   * @param {string=} email the service account email address.
   * @param {string=} key the private key that will be used to sign the token.
   * @constructor
   */
  constructor(email?: string|null, key?: string|null) {
    this.email = email;
    this.key = key;
  }

  /**
   * Indicates whether the credential requires scopes to be created by calling
   * createdScoped before use.
   *
   * @return {boolean} always false
   */
  createScopedRequired(): boolean {
    // JWT Header authentication does not use scopes.
    return false;
  }

  /**
   * Get a non-expired access token, after refreshing if necessary
   *
   * @param {string} authURI the URI being authorized
   * @param {function} metadataCb a callback invoked with the jwt request metadata.
   * @returns a Promise that resolves with the request metadata response
   */
  getRequestMetadata(authURI: string): RequestMetadataResponse {
    const iat = Math.floor(new Date().getTime() / 1000);
    const exp = iat + 3600;  // 3600 seconds = 1 hour

    // The payload used for signed JWT headers has:
    // iss == sub == <client email>
    // aud == <the authorization uri>
    const payload = {iss: this.email, sub: this.email, aud: authURI, exp, iat};
    const assertion = {
      header: {alg: 'RS256'} as jws.Header,
      payload,
      secret: this.key
    };

    // Sign the jwt and invoke metadataCb with it.
    const signedJWT =
        jws.sign({header: {alg: 'RS256'}, payload, secret: this.key});
    return {headers: {Authorization: 'Bearer ' + signedJWT}};
  }

  /**
   * Create a JWTAccess credentials instance using the given input options.
   * @param {object=} json The input object.
   */
  fromJSON(json: JWTInput): void {
    if (!json) {
      throw new Error(
          'Must pass in a JSON object containing the service account auth settings.');
    }
    if (!json.client_email) {
      throw new Error(
          'The incoming JSON object does not contain a client_email field');
    }
    if (!json.private_key) {
      throw new Error(
          'The incoming JSON object does not contain a private_key field');
    }
    // Extract the relevant information from the json key file.
    this.email = json.client_email;
    this.key = json.private_key;
    this.projectId = json.project_id;
  }

  /**
   * Create a JWTAccess credentials instance using the given input stream.
   * @param {object=} inputStream The input stream.
   * @param {function=} callback Optional callback.
   */
  fromStream(inputStream: stream.Readable): Promise<void>;
  fromStream(inputStream: stream.Readable, callback: (err?: Error) => void):
      void;
  fromStream(inputStream: stream.Readable, callback?: (err?: Error) => void):
      void|Promise<void> {
    if (callback) {
      this.fromStreamAsync(inputStream).then(r => callback()).catch(callback);
    } else {
      return this.fromStreamAsync(inputStream);
    }
  }

  private fromStreamAsync(inputStream: stream.Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!inputStream) {
        reject(new Error(
            'Must pass in a stream containing the service account auth settings.'));
      }
      let s = '';
      inputStream.setEncoding('utf8');
      inputStream.on('data', (chunk) => {
        s += chunk;
      });
      inputStream.on('end', () => {
        try {
          const data = JSON.parse(s);
          this.fromJSON(data);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}
