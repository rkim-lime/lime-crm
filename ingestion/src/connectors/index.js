import { register } from './registry.js';
import sec13fConnector from './ingest_13f/index.js';
import advConnector    from './ingest_adv/index.js';

register(sec13fConnector);
register(advConnector);
