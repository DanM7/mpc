import { app, HttpRequest, HttpResponseInit, input, output } from '@azure/functions';
import { ContainerClient } from '@azure/storage-blob';
import { CosmosClient } from '@azure/cosmos';

// Cosmos DB input binding
const cosmosInput = input.cosmosDB({
    connectionString: 'AzureWebJobsCosmosDB',
    databaseName: 'mpc-sampler',
    collectionName: 'patterns',
    partitionKey: '/userId',
});

// Cosmos DB output binding
const cosmosOutput = output.cosmosDB({
    connectionString: 'AzureWebJobsCosmosDB',
    databaseName: 'mpc-sampler',
    collectionName: 'patterns',
    partitionKey: '/userId',
});

// Blob storage output binding for sound files
const blobOutput = output.storageBlob({
    connection: 'AzureWebJobsStorage',
    path: 'sounds/$ {rand-guid}',
});

// Get patterns for a user
app.http('getPatterns', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'patterns/{userId}',
    extraInputs: [cosmosInput],
    handler: async (request: HttpRequest, context: & any): Promise<HttpResponseInit> => {
        const userId = request.params.userId;
        
        try {
            const documents = context.extraInputs.get(cosmosInput);
            const userPatterns = documents?.filter((d: any) => d.userId === userId) || [];
            
            return {
                status: 200,
                jsonBody: userPatterns
            };
        } catch (error) {
            context.log.error('Error fetching patterns:', error);
            return { status: 500, body: 'Error fetching patterns' };
        }
    }
});

// Save a pattern
app.http('savePattern', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'patterns',
    extraInputs: [cosmosInput],
    handler: async (request: HttpRequest, context: & any): Promise<HttpResponseInit> => {
        try {
            const pattern = await request.json();
            
            return {
                status: 201,
                jsonBody: { id: pattern.id || `pattern-${Date.now()}`, ...pattern }
            };
        } catch (error) {
            context.log.error('Error saving pattern:', error);
            return { status: 500, body: 'Error saving pattern' };
        }
    }
});

// Delete a pattern
app.http('deletePattern', {
    methods: ['DELETE'],
    authLevel: 'function',
    route: 'patterns/{userId}/{patternId}',
    handler: async (request: HttpRequest, context: & any): Promise<HttpResponseInit> => {
        const patternId = request.params.patternId;
        
        try {
            return {
                status: 200,
                jsonBody: { deleted: patternId }
            };
        } catch (error) {
            context.log.error('Error deleting pattern:', error);
            return { status: 500, body: 'Error deleting pattern' };
        }
    }
});

// Upload sound file
app.http('uploadSound', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'sounds',
    handler: async (request: HttpRequest, context: & any): Promise<HttpResponseInit> => {
        try {
            const formData = await request.formData();
            const file = formData.get('file');
            
            if (!file) {
                return { status: 400, body: 'No file provided' };
            }

            // TODO(azure-blob): Replace this placeholder response with a real
            // ContainerClient upload to the configured sounds container.
            // TODO(azure-blob): Generate a safe blob name that includes user/pad
            // metadata, content type, and a unique suffix.
            // TODO(azure-blob): Return the durable blob URL plus any metadata the
            // frontend needs to replay and label the sample.
            return {
                status: 201,
                jsonBody: { 
                    url: `https://your-storage.blob.core.windows.net/sounds/${Date.now()}-${file.name}`,
                    name: file.name 
                }
            };
        } catch (error) {
            context.log.error('Error uploading sound:', error);
            return { status: 500, body: 'Error uploading sound' };
        }
    }
});

// Get sound packs for a user
app.http('getSoundPacks', {
    methods: ['GET'],
    authLevel: 'function',
    route: 'soundpacks/{userId}',
    extraInputs: [cosmosInput],
    handler: async (request: HttpRequest, context: & any): Promise<HttpResponseInit> => {
        const userId = request.params.userId;
        
        try {
            const documents = context.extraInputs.get(cosmosInput);
            const soundPacks = documents?.filter((d: any) => d.userId === userId && d.type === 'soundpack') || [];
            
            return {
                status: 200,
                jsonBody: soundPacks
            };
        } catch (error) {
            context.log.error('Error fetching sound packs:', error);
            return { status: 500, body: 'Error fetching sound packs' };
        }
    }
});

// Save sound pack
app.http('saveSoundPack', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'soundpacks',
    handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
        try {
            const soundPack = await request.json();
            
            return {
                status: 201,
                jsonBody: { id: soundPack.id || `pack-${Date.now()}`, ...soundPack, type: 'soundpack' }
            };
        } catch (error) {
            context.log.error('Error saving sound pack:', error);
            return { status: 500, body: 'Error saving sound pack' };
        }
    }
});