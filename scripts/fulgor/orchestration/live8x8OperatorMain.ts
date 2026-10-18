import {
  live8x8OperatorSummary,
  runLive8x8Operator,
} from './live8x8OperatorRunner';

runLive8x8Operator()
  .then(
    result => {
      process.stdout.write(
        live8x8OperatorSummary(
          result,
        ),
      );
    },
  )
  .catch(
    () => {
      process.stderr.write(
        'LIVE_8X8_OPERATOR_FAILURE\n',
      );

      process.exitCode =
        1;
    },
  );
