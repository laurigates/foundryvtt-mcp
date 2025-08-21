# Test Fixtures

This directory contains test data and configurations for integration tests.

## Structure

- `foundry-data/` - FoundryVTT data directory mounted in test containers
- `modules/` - Test modules to be loaded into FoundryVTT
- `worlds/` - Pre-configured test worlds with known data sets
- `actors/` - Test actor JSON files
- `items/` - Test item JSON files

## Usage

These fixtures are used by integration tests to provide consistent, predictable test data when testing against real FoundryVTT instances.

The `docker-compose.test.yml` file mounts these directories into the FoundryVTT container to ensure tests run against known data sets.