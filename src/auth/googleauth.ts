/**
 * Copyright 2014 Google Inc. All Rights Reserved.
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

import {exec} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as stream from 'stream';
import * as util from 'util';

import {DefaultTransporter, Transporter} from '../transporters';
import {Compute} from './computeclient';
import {JWTInput} from './credentials';
import {IAMAuth} from './iam';
import {JWTAccess} from './jwtaccess';
import {JWT} from './jwtclient';
import {OAuth2Client} from './oauth2client';
import {UserRefreshClient} from './refreshclient';

export interface ProjectIdCallback {
  (err?: Error|null, projectId?: string|null): void;
}

export interface CredentialCallback {
  (err: Error|null, result?: UserRefreshClient|JWT): void;
}

export interface ADCCallback {
  (err: Error|null, credential?: OAuth2Client, projectId?: string|null): void;
}

export interface ADCResponse {
  credential: OAuth2Client;
  projectId: string|null;
}

export interface CredentialBody {
  client_email?: string;
  private_key?: string;
}

interface CredentialResult {
  default: {email: string;};
}

export class GoogleAuth {
  transporter: Transporter;

  /**
   * Caches a value indicating whether the auth layer is running on Google
   * Compute Engine.
   * @private
   */
  private checkIsGCE?: boolean = undefined;

  // Note:  this properly is only public to satisify unit tests.
  // https://github.com/Microsoft/TypeScript/issues/5228
  get isGCE() {
    return this.checkIsGCE;
  }

  private _cachedProjectId: string;

  // Note:  this properly is only public to satisify unit tests.
  // https://github.com/Microsoft/TypeScript/issues/5228
  set cachedProjectId(projectId: string) {
    this._cachedProjectId = projectId;
  }
  // To save the contents of the JSON credential file
  jsonContent: JWTInput|null = null;

  cachedCredential: OAuth2Client|null = null;

  /**
   * Convenience field mapping in the IAM credential type.
   */
  IAMAuth = IAMAuth;

  /**
   * Convenience field mapping in the Compute credential type.
   */
  Compute = Compute;

  /**
   * Convenience field mapping in the JWT credential type.
   */
  JWT = JWT;

  /**
   * Convenience field mapping in the JWT Access credential type.
   */
  JWTAccess = JWTAccess;

  /**
   * Convenience field mapping in the OAuth2 credential type.
   */
  // lint is checking for camelCase properties, but OAuth is proper here
  // tslint:disable-next-line variable-name
  OAuth2 = OAuth2Client;

  /**
   * Convenience field mapping to the UserRefreshClient credential type.
   */
  UserRefreshClient = UserRefreshClient;

  /**
   * Export DefaultTransporter as a static property of the class.
   */
  static DefaultTransporter = DefaultTransporter;

  /**
   * Obtains the default project ID for the application..
   * @param callback Optional callback
   * @returns Promise that resolves with project Id (if used without callback)
   */
  getDefaultProjectId(): Promise<string>;
  getDefaultProjectId(callback: ProjectIdCallback): void;
  getDefaultProjectId(callback?: ProjectIdCallback): Promise<string|null>|void {
    if (callback) {
      this.getDefaultProjectIdAsync()
          .then(r => callback(null, r))
          .catch(callback);
    } else {
      return this.getDefaultProjectIdAsync();
    }
  }

  private async getDefaultProjectIdAsync(): Promise<string|null> {
    // In implicit case, supports three environments. In order of precedence,
    // the implicit environments are:
    //
    // * GCLOUD_PROJECT or GOOGLE_CLOUD_PROJECT environment variable
    // * GOOGLE_APPLICATION_CREDENTIALS JSON file
    // * Get default service project from
    //  ``$ gcloud beta auth application-default login``
    // * Google App Engine application ID (Not implemented yet)
    // * Google Compute Engine project ID (from metadata server) (Not
    // implemented yet)

    if (this._cachedProjectId) {
      return this._cachedProjectId;
    }

    const projectId = this.getProductionProjectId() ||
        await this.getFileProjectId() ||
        await this.getDefaultServiceProjectId() || await this.getGCEProjectId();
    if (projectId) {
      this._cachedProjectId = projectId;
    }
    return projectId;
  }

  /**
   * Run the Google Cloud SDK command that prints the default project ID
   */
  _getSDKDefaultProjectId():
      Promise<{stdout: string | null, stderr: string|null}> {
    // TODO: make this a proper async function
    return new Promise((resolve, reject) => {
      exec(
          'gcloud -q config list core/project --format=json',
          (err, stdout, stderr) => {
            if (err) {
              reject(err);
            } else {
              resolve({stdout, stderr});
            }
          });
    });
  }

  /**
   * Obtains the default service-level credentials for the application.
   * @param {function=} callback Optional callback.
   * @returns Promise that resolves with the ADCResponse (if no callback was
   * passed).
   */
  getApplicationDefault(): Promise<ADCResponse>;
  getApplicationDefault(callback: ADCCallback): void;
  getApplicationDefault(callback?: ADCCallback): void|Promise<ADCResponse> {
    if (callback) {
      this.getApplicationDefaultAsync()
          .then(r => callback(null, r.credential, r.projectId))
          .catch(callback);
    } else {
      return this.getApplicationDefaultAsync();
    }
  }

  private async getApplicationDefaultAsync(): Promise<ADCResponse> {
    // If we've already got a cached credential, just return it.
    if (this.cachedCredential) {
      return {
        credential: this.cachedCredential as JWT | UserRefreshClient,
        projectId: this._cachedProjectId
      };
    }

    let credential: OAuth2Client|null;
    let projectId: string|null;
    // Check for the existence of a local environment variable pointing to the
    // location of the credential file. This is typically used in local
    // developer scenarios.
    credential =
        await this._tryGetApplicationCredentialsFromEnvironmentVariable();
    if (credential) {
      this.cachedCredential = credential;
      projectId = await this.getDefaultProjectId();
      return {credential, projectId};
    }

    // Look in the well-known credential file location.
    credential = await this._tryGetApplicationCredentialsFromWellKnownFile();
    if (credential) {
      this.cachedCredential = credential;
      projectId = await this.getDefaultProjectId();
      return {credential, projectId};
    }

    try {
      // Determine if we're running on GCE.
      const gce = await this._checkIsGCE();
      if (gce) {
        // For GCE, just return a default ComputeClient. It will take care of
        // the rest.
        // TODO: cache the result
        return {projectId: null, credential: new Compute()};
      } else {
        // We failed to find the default credentials. Bail out with an error.
        throw new Error(
            'Could not load the default credentials. Browse to https://developers.google.com/accounts/docs/application-default-credentials for more information.');
      }
    } catch (e) {
      throw new Error(
          'Unexpected error while acquiring application default credentials: ' +
          e.message);
    }
  }

  /**
   * Determines whether the auth layer is running on Google Compute Engine.
   * @returns A promise that resolves with the boolean.
   * @api private
   */
  async _checkIsGCE(): Promise<boolean> {
    if (this.checkIsGCE !== undefined) {
      return this.checkIsGCE;
    }
    if (!this.transporter) {
      this.transporter = new DefaultTransporter();
    }
    try {
      const res = await this.transporter.request(
          {url: 'http://metadata.google.internal'});
      this.checkIsGCE =
          res && res.headers && res.headers['metadata-flavor'] === 'Google';
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOTFOUND') {
        // Unexpected error occurred. TODO(ofrobots): retry if this was a
        // transient error.
        throw e;
      }
      this.checkIsGCE = false;
    }
    return this.checkIsGCE;
  }

  /**
   * Attempts to load default credentials from the environment variable path..
   * @returns Promise that resolves with the OAuth2Client or null.
   * @api private
   */
  async _tryGetApplicationCredentialsFromEnvironmentVariable():
      Promise<JWT|UserRefreshClient|null> {
    const credentialsPath = this._getEnv('GOOGLE_APPLICATION_CREDENTIALS');
    if (!credentialsPath || credentialsPath.length === 0) {
      return null;
    }
    try {
      return this._getApplicationCredentialsFromFilePath(credentialsPath);
    } catch (e) {
      throw this.createError(
          'Unable to read the credential file specified by the GOOGLE_APPLICATION_CREDENTIALS environment variable.',
          e);
    }
  }

  /**
   * Attempts to load default credentials from a well-known file location
   * @return Promise that resolves with the OAuth2Client or null.
   * @api private
   */
  async _tryGetApplicationCredentialsFromWellKnownFile():
      Promise<JWT|UserRefreshClient|null> {
    // First, figure out the location of the file, depending upon the OS type.
    let location = null;
    if (this._isWindows()) {
      // Windows
      location = this._getEnv('APPDATA');
    } else {
      // Linux or Mac
      const home = this._getEnv('HOME');
      if (home) {
        location = this._pathJoin(home, '.config');
      }
    }
    // If we found the root path, expand it.
    if (location) {
      location = this._pathJoin(location, 'gcloud');
      location =
          this._pathJoin(location, 'application_default_credentials.json');
      location = this._mockWellKnownFilePath(location);
      // Check whether the file exists.
      if (!this._fileExists(location)) {
        location = null;
      }
    }
    // The file does not exist.
    if (!location) {
      return null;
    }
    // The file seems to exist. Try to use it.
    return this._getApplicationCredentialsFromFilePath(location);
  }

  /**
   * Attempts to load default credentials from a file at the given path..
   * @param {string=} filePath The path to the file to read.
   * @returns Promise that resolves with the OAuth2Client
   * @api private
   */
  async _getApplicationCredentialsFromFilePath(filePath: string):
      Promise<JWT|UserRefreshClient> {
    // Make sure the path looks like a string.
    if (!filePath || filePath.length === 0) {
      throw new Error('The file path is invalid.');
    }

    // Make sure there is a file at the path. lstatSync will throw if there is
    // nothing there.
    try {
      // Resolve path to actual file in case of symlink. Expect a thrown error
      // if not resolvable.
      filePath = fs.realpathSync(filePath);

      if (!fs.lstatSync(filePath).isFile()) {
        throw new Error();
      }
    } catch (err) {
      throw this.createError(
          util.format(
              'The file at %s does not exist, or it is not a file.', filePath),
          err);
    }

    // Now open a read stream on the file, and parse it.
    try {
      const readStream = this._createReadStream(filePath);
      return this.fromStream(readStream);
    } catch (err) {
      throw this.createError(
          util.format('Unable to read the file at %s.', filePath), err);
    }
  }

  /**
   * Create a credentials instance using the given input options.
   * @param {object=} json The input object.
   * @param {function=} callback Optional callback.
   * @returns Promise that resolves with the OAuth2Client (if no callback is
   * passed)
   */
  // TODO: Remove the overloads and just keep this a sync API
  fromJSON(json: JWTInput): JWT|UserRefreshClient;
  fromJSON(json: JWTInput, callback: CredentialCallback): void;
  fromJSON(json: JWTInput, callback?: CredentialCallback): JWT|UserRefreshClient
      |void {
    let client: UserRefreshClient|JWT;
    try {
      if (!json) {
        throw new Error(
            'Must pass in a JSON object containing the Google auth settings.');
      }

      this.jsonContent = json;
      if (json.type === 'authorized_user') {
        client = new UserRefreshClient();
      } else {
        client = new JWT();
      }
      client.fromJSON(json);
      if (callback) {
        return callback(null, client);
      } else {
        return client;
      }

    } catch (e) {
      if (callback) {
        return callback(e);
      } else {
        throw e;
      }
    }
  }

  /**
   * Create a credentials instance using the given input stream.
   * @param {object=} inputStream The input stream.
   * @param {function=} callback Optional callback.
   */
  fromStream(inputStream: stream.Readable): Promise<JWT|UserRefreshClient>;
  fromStream(inputStream: stream.Readable, callback: CredentialCallback): void;
  fromStream(inputStream: stream.Readable, callback?: CredentialCallback):
      Promise<JWT|UserRefreshClient>|void {
    if (callback) {
      this.fromStreamAsync(inputStream)
          .then(r => callback(null, r))
          .catch(callback);
    } else {
      return this.fromStreamAsync(inputStream);
    }
  }

  private fromStreamAsync(inputStream: stream.Readable):
      Promise<JWT|UserRefreshClient> {
    return new Promise((resolve, reject) => {
      if (!inputStream) {
        throw new Error(
            'Must pass in a stream containing the Google auth settings.');
      }
      let s = '';
      inputStream.setEncoding('utf8');
      inputStream.on('data', (chunk) => {
        s += chunk;
      });
      inputStream.on('end', () => {
        try {
          const data = JSON.parse(s);
          const r = this.fromJSON(data);
          return resolve(r);
        } catch (err) {
          return reject(err);
        }
      });
    });
  }

  /**
   * Create a credentials instance using the given API key string.
   * @param {string} - The API key string
   * @param {function=} - Optional callback function
   */
  fromAPIKey(
      apiKey: string,
      callback?: (err?: Error|null, client?: JWT) => void): void|JWT {
    const client = new JWT();
    try {
      client.fromAPIKey(apiKey);
      if (callback) {
        callback(null, client);
      } else {
        return client;
      }
    } catch (e) {
      if (callback) {
        callback(e);
      } else {
        throw e;
      }
    }
  }

  /**
   * Determines whether the current operating system is Windows.
   * @api private
   */
  private _isWindows() {
    const sys = this._osPlatform();
    if (sys && sys.length >= 3) {
      if (sys.substring(0, 3).toLowerCase() === 'win') {
        return true;
      }
    }
    return false;
  }

  /**
   * Creates a file stream. Allows mocking.
   * @api private
   */
  _createReadStream(filePath: string) {
    return fs.createReadStream(filePath);
  }

  /**
   * Gets the value of the environment variable with the given name. Allows
   * mocking.
   * @api private
   */
  _getEnv(name: string) {
    return process.env[name];
  }

  /**
   * Gets the current operating system platform. Allows mocking.
   * @api private
   */
  _osPlatform() {
    return os.platform();
  }

  /**
   * Determines whether a file exists. Allows mocking.
   * @api private
   */
  _fileExists(filePath: string) {
    return fs.existsSync(filePath);
  }

  /**
   * Joins two parts of a path. Allows mocking.
   * @api private
   */
  _pathJoin(item1: string, item2: string) {
    return path.join(item1, item2);
  }

  /**
   * Allows mocking of the path to a well-known file.
   * @api private
   */
  _mockWellKnownFilePath(filePath: string) {
    return filePath;
  }

  // Creates an Error containing the given message, and includes the message
  // from the optional err passed in.
  private createError(message: string, err: Error) {
    let s = message || '';
    if (err) {
      const errorMessage = String(err);
      if (errorMessage && errorMessage.length > 0) {
        if (s.length > 0) {
          s += ' ';
        }
        s += errorMessage;
      }
    }
    return Error(s);
  }

  /**
   * Loads the default project of the Google Cloud SDK.
   * @api private
   */
  private async getDefaultServiceProjectId(): Promise<string|null> {
    try {
      const r = await this._getSDKDefaultProjectId();
      if (r.stdout) {
        return JSON.parse(r.stdout).core.project;
      }
    } catch (e) {
      // Ignore any errors
    }
    return null;
  }

  /**
   * Loads the project id from environment variables.
   * @api private
   */
  private getProductionProjectId() {
    return this._getEnv('GCLOUD_PROJECT') ||
        this._getEnv('GOOGLE_CLOUD_PROJECT');
  }

  /**
   * Loads the project id from the GOOGLE_APPLICATION_CREDENTIALS json file.
   * @api private
   */
  private async getFileProjectId(): Promise<string|undefined|null> {
    if (this.cachedCredential) {
      // Try to read the project ID from the cached credentials file
      return this.cachedCredential.projectId;
    }

    // Try to load a credentials file and read its project ID
    const r = await this._tryGetApplicationCredentialsFromEnvironmentVariable();
    if (r) {
      return r.projectId;
    } else {
      return null;
    }
  }

  /**
   * Gets the Compute Engine project ID if it can be inferred.
   * Uses 169.254.169.254 for the metadata server to avoid request
   * latency from DNS lookup.
   * See https://cloud.google.com/compute/docs/metadata#metadataserver
   * for information about this IP address. (This IP is also used for
   * Amazon EC2 instances, so the metadata flavor is crucial.)
   * See https://github.com/google/oauth2client/issues/93 for context about
   * DNS latency.
   *
   * @api private
   */
  private async getGCEProjectId() {
    if (!this.transporter) {
      this.transporter = new DefaultTransporter();
    }
    try {
      const r = await this.transporter.request<string>({
        url: 'http://169.254.169.254/computeMetadata/v1/project/project-id',
        headers: {'Metadata-Flavor': 'Google'}
      });
      return r.data;
    } catch (e) {
      // Ignore any errors
      return null;
    }
  }


  /**
   * The callback function handles a credential object that contains the
   * client_email and private_key (if exists).
   * getCredentials checks for these values from the user JSON at first.
   * If it doesn't exist, and the environment is on GCE, it gets the
   * client_email from the cloud metadata server.
   * @param callback Callback that handles the credential object that contains
   * a client_email and optional private key, or the error.
   * returned
   */
  getCredentials(): Promise<CredentialBody>;
  getCredentials(
      callback: (err: Error|null, credentials?: CredentialBody) => void): void;
  getCredentials(
      callback?: (err: Error|null, credentials?: CredentialBody) => void):
      void|Promise<CredentialBody> {
    if (callback) {
      this.getCredentialsAsync().then(r => callback(null, r)).catch(callback);
    } else {
      return this.getCredentialsAsync();
    }
  }

  private async getCredentialsAsync(): Promise<CredentialBody> {
    if (this.jsonContent) {
      const credential: CredentialBody = {
        client_email: this.jsonContent.client_email,
        private_key: this.jsonContent.private_key
      };
      return credential;
    }

    const isGCE = await this._checkIsGCE();
    if (!isGCE) {
      throw new Error('Unknown error.');
    }

    // For GCE, return the service account details from the metadata server
    const result = await this.transporter.request<CredentialResult>({
      url:
          'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/?recursive=true',
      headers: {'Metadata-Flavor': 'Google'}
    });

    if (!result.data || !result.data.default || !result.data.default.email) {
      throw new Error('Failure from metadata server.');
    }

    // Callback with the body
    const credential:
        CredentialBody = {client_email: result.data.default.email};
    return credential;
  }
}
