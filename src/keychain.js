/**
 * iCloud Keychain utility functions for managing secrets
 */

import { spawn } from 'child_process';
import { promisify } from 'util';

/**
 * Execute a security command and return the result
 * @param {string[]} args - Command arguments
 * @returns {Promise<string>} - Command output
 */
const executeSecurityCommand = (args) => {
    return new Promise((resolve, reject) => {
        const process = spawn('security', ['-i', ...args]);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                const error = new Error(`Security command failed with code ${code}`);
                error.stderr = stderr;
                error.code = code;
                reject(error);
            }
        });

        process.on('error', (error) => {
            reject(error);
        });
    });
};

/**
 * Get a secret from iCloud Keychain
 * @param {string} service - Keychain service name
 * @param {string} account - Account/key name
 * @returns {Promise<string|null>} - Secret value or null if not found
 */
export const getSecret = async (service, account) => {
    try {
        const result = await executeSecurityCommand([
            'find-generic-password',
            '-s', service,
            '-a', account,
            '-w'
        ]);
        return result;
    } catch (error) {
        console.error(`Error accessing iCloud Keychain for ${account}:`, error.message);
        return null;
    }
};

/**
 * Delete a secret from the iCloud Keychain
 * @param {string} service - Keychain service name
 * @param {string} account - Account/key name
 * @returns {Promise<boolean>} - True if successful or secret doesn't exist
 */
export const deleteSecret = async (service, account) => {
    try {
        await executeSecurityCommand([
            'delete-generic-password',
            '-s', service,
            '-a', account
        ]);
        return true;
    } catch (error) {
        // If secret doesn't exist, that's fine
        if (error.stderr && error.stderr.includes('The specified item could not be found')) {
            return true;
        }
        console.error(`Error deleting iCloud Keychain secret for ${account}:`, error.message);
        return false;
    }
};

/**
 * Add or update a secret in the iCloud Keychain
 * @param {string} service - Keychain service name
 * @param {string} account - Account/key name
 * @param {string} secret - Secret value
 * @returns {Promise<boolean>} - True if successful
 */
export const addSecret = async (service, account, secret) => {
    try {
        // Delete existing password if it exists (ignore errors)
        await deleteSecret(service, account);
        
        // Add new password to iCloud Keychain
        await executeSecurityCommand([
            'add-generic-password',
            '-s', service,
            '-a', account,
            '-w', secret
        ]);
        return true;
    } catch (error) {
        console.error(`Error setting iCloud Keychain secret for ${account}:`, error.message);
        return false;
    }
};

/**
 * Load secrets from iCloud Keychain into environment variables
 * @param {Array<[string, string, string?]>} secrets - Array of [service, account, envVar?] tuples
 * @returns {Promise<boolean>} - True if all secrets were loaded successfully
 */
export const loadSecrets = async (secrets) => {
    let success = true;
    
    for (const secretConfig of secrets) {
        const [service, account, envVar] = secretConfig;
        const environmentVariable = envVar || account;
        
        const secret = await getSecret(service, account);
        if (secret) {
            process.env[environmentVariable] = secret;
        } else {
            success = false;
        }
    }
    
    return success;
};

/**
 * CLI interface for managing keychain secrets
 */
export const cli = async () => {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.error('Usage: node keychain.js <action> <service> <account> [secret]');
        console.error('Actions: get, set, delete');
        process.exit(1);
    }
    
    const [action, service, account, secret] = args;
    
    try {
        switch (action) {
            case 'get':
                const retrievedSecret = await getSecret(service, account);
                if (retrievedSecret) {
                    console.log(retrievedSecret);
                    process.exit(0);
                } else {
                    process.exit(1);
                }
                break;
                
            case 'set':
                if (!secret) {
                    console.error("'set' action requires a secret value");
                    process.exit(1);
                }
                const setSuccess = await addSecret(service, account, secret);
                if (setSuccess) {
                    console.log(`Successfully added secret ${account} to iCloud Keychain`);
                    process.exit(0);
                } else {
                    process.exit(1);
                }
                break;
                
            case 'delete':
                const deleteSuccess = await deleteSecret(service, account);
                if (deleteSuccess) {
                    console.log(`Successfully deleted secret ${account} from iCloud Keychain`);
                    process.exit(0);
                } else {
                    process.exit(1);
                }
                break;
                
            default:
                console.error(`Unknown action: ${action}`);
                console.error('Valid actions: get, set, delete');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
};

// If this file is run directly, execute the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    cli();
} 