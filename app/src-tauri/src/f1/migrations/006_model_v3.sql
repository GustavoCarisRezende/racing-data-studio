-- Version gate prevents older v2-only applications from opening v3 model data.
CREATE INDEX f1_saved_models_revision_idx ON f1_saved_models(revision);
