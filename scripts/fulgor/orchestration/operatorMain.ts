import { operatorSummary, runOperator } from './operatorRunner';

// No raw exceptions, task data, or model transcripts cross the operator boundary.
runOperator().then(result => { process.stdout.write(operatorSummary(result)); }).catch(() => {
  process.stderr.write('OPERATOR_FAILURE\n');
  process.exitCode = 1;
});
