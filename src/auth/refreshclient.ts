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

import * as stream from 'stream';
import {JWTInput} from './credentials';
import {GetTokenResponse, OAuth2Client} from './oauth2client';

export class UserRefreshClient extends OAuth2Client {
  // TODO: refactor tests to make this private
  // In a future gts release, the _propertyName rule will be lifted.
  // This is also a hard one because `this.refreshToken` is a function.
  _refreshToken?: string|null;

  /**
   * User Refresh Token credentials.
   *
   * @param {string} clientId The authentication client ID.
   * @param {string} clientSecret The authentication client secret.
   * @param {string} refreshToken The authentication refresh token.
   * @constructor
   */
  constructor(clientId?: string, clientSecret?: string, refreshToken?: string) {
    super(clientId, clientSecret);
    this._refreshToken = refreshToken;
  }

  /**
   * Refreshes the access token.
   * @param {object=} ignored
   * @param {function=} callback Optional callback.
   * @private
   */
  protected async refreshToken(refreshToken?: string|
                               null): Promise<GetTokenResponse> {
    return super.refreshToken(this._refreshToken);
  }

  /**
   * Create a UserRefreshClient credentials instance using the given input
   * options.
   * @param {object=} json The input object.
   * @param {function=} callback Optional callback.
   */
  fromJSON(json: JWTInput, callback?: (err?: Error) => void) {
    try {
      if (!json) {
        throw new Error(
            'Must pass in a JSON object containing the user refresh token');
      }
      if (json.type !== 'authorized_user') {
        throw new Error(
            'The incoming JSON object does not have the "authorized_user" type');
      }
      if (!json.client_id) {
        throw new Error(
            'The incoming JSON object does not contain a client_id field');
      }
      if (!json.client_secret) {
        throw new Error(
            'The incoming JSON object does not contain a client_secret field');
      }
      if (!json.refresh_token) {
        throw new Error(
            'The incoming JSON object does not contain a refresh_token field');
      }
      this._clientId = json.client_id;
      this._clientSecret = json.client_secret;
      this._refreshToken = json.refresh_token;
      this.credentials.refresh_token = json.refresh_token;
    } catch (e) {
      if (callback) {
        callback(e);
      } else {
        throw e;
      }
    }
    if (callback) callback();
  }

  /**
   * Create a UserRefreshClient credentials instance using the given input
   * stream.
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

  private async fromStreamAsync(inputStream: stream.Readable): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!inputStream) {
        return reject(new Error(
            'Must pass in a stream containing the user refresh token.'));
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
          return resolve();
        } catch (err) {
          return reject(err);
        }
      });
    });
  }
}
