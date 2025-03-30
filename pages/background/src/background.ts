// Add both minimum and maximum step execution times
const MAX_STEP_TIME = 60000; // 60 seconds max per step
const MIN_STEP_TIME = 2000; // Ensure each step takes at least 2 seconds

function executeStep(step, context) {
  let stepTimer = null;
  const startTime = Date.now();

  // Create a timeout that will force progress if a step takes too long
  stepTimer = setTimeout(() => {
    console.warn('Step timeout reached - forcing next step');
    // Force progression to next step
    progressToNextStep(context);
  }, MAX_STEP_TIME);

  try {
    // Your existing step execution code
    // ...

    // After step completes successfully, ensure minimum execution time
    const endTime = Date.now();
    const elapsedTime = endTime - startTime;

    if (elapsedTime < MIN_STEP_TIME) {
      const remainingTime = MIN_STEP_TIME - elapsedTime;
      console.log(`Step completed too quickly, adding ${remainingTime}ms delay`);

      setTimeout(() => {
        clearTimeout(stepTimer);
        // Progress to next step after the delay
        progressToNextStep(context);
      }, remainingTime);
    } else {
      clearTimeout(stepTimer);
      // Progress to next step immediately
      progressToNextStep(context);
    }
  } catch (error) {
    clearTimeout(stepTimer);
    console.error('Step execution error:', error);
    // Handle the error and try to continue
    progressToNextStep(context);
  }
}
